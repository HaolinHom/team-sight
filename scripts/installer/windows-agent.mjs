import * as fs from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { configureCodex, parseConfig } from './config.mjs'
import { compareReleases, digest, inspectData } from './main.mjs'

const fail = code => { throw Error(code) }
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const samePath = (left, right) => typeof left === 'string' && resolve(left).toLowerCase() === resolve(right).toLowerCase()

export function verifyWindowsPayload(directory, version, variant, checksum) {
  compareReleases(version, version)
  if (fs.lstatSync(directory).isSymbolicLink()) fail('PAYLOAD_LINK_REFUSED')
  const listPath = join(directory, 'checksums.json')
  const listStat = fs.lstatSync(listPath)
  if (!listStat.isFile() || listStat.isSymbolicLink() || digest(fs.readFileSync(listPath)) !== checksum) fail('PAYLOAD_MANIFEST_MISMATCH')
  const expected = json(listPath), seen = new Set()
  function walk(at) {
    for (const entry of fs.readdirSync(at)) {
      const file = join(at, entry), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) fail('PAYLOAD_LINK_REFUSED')
      if (stat.isDirectory()) walk(file)
      else {
        const key = relative(directory, file).split(sep).join('/')
        if (key === 'checksums.json') continue
        if (!stat.isFile() || !Object.hasOwn(expected, key) || digest(fs.readFileSync(file)) !== expected[key]) fail('PAYLOAD_HASH_MISMATCH')
        seen.add(key)
      }
    }
  }
  walk(directory)
  if (seen.size !== Object.keys(expected).length) fail('PAYLOAD_FILE_SET_MISMATCH')
  const manifest = json(join(directory, 'versions.json'))
  if (manifest.target !== 'win32-x64' || manifest.version !== version || manifest.variant !== variant ||
      !['external', 'bundled'].includes(variant) || (variant === 'bundled' && manifest.runtime?.executableSha256 !== expected['runtime/node.exe'])) fail('PAYLOAD_RELEASE_MISMATCH')
  return manifest
}

function safePath(file) {
  if (process.platform === 'win32' && !/^[a-z]:\\/i.test(resolve(file))) fail('LOCAL_PATH_REQUIRED')
  for (let at = resolve(file); ; at = dirname(at)) {
    const stat = fs.lstatSync(at, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) fail('LINK_PATH_REFUSED')
    if (dirname(at) === at) return
  }
}

async function connection(data, version, port) {
  const url = `http://127.0.0.1:${port}/mcp`
  for (const name of ['instance.json', 'instance.lock', 'access-token']) safePath(join(data, name))
  const info = json(join(data, 'instance.json')), lock = json(join(data, 'instance.lock'))
  const token = fs.readFileSync(join(data, 'access-token'), 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(token) || !Number.isSafeInteger(info.pid) || info.pid <= 0 ||
      typeof info.instanceId !== 'string' || info.url !== url || !samePath(info.dataDir, data) ||
      lock.instanceId !== info.instanceId || lock.pid !== info.pid) fail('INSTANCE_IDENTITY_MISMATCH')
  const headers = { Authorization: 'Bearer ' + token }
  const response = await fetch(new URL('/health', url), { headers, redirect: 'error', signal: AbortSignal.timeout(2500) })
  if (!response.ok) fail('SERVICE_HEALTH_FAILED')
  const status = await response.json()
  if (status.instanceId !== info.instanceId || status.pid !== info.pid || status.version !== version) fail('INSTANCE_IDENTITY_MISMATCH')
  return { url, headers, status }
}

async function mcpStatus(directory, { url, headers, status }) {
  const require = createRequire(join(directory, 'package.json'))
  const { Client, StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')).href)
  const client = new Client({ name: 'teamsight-windows-installer', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers, redirect: 'error', signal: AbortSignal.timeout(15000) } })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    const result = await client.callTool({ name: 'teamsight_status', arguments: {} })
    if (!tools.some(tool => tool.name === 'teamsight_status') || result.isError ||
        result.structuredContent?.instanceId !== status.instanceId || result.structuredContent?.version !== status.version) fail('MCP_VERIFICATION_FAILED')
    return { ...status, tools: tools.length }
  } finally { await transport.terminateSession().catch(() => {}); await client.close().catch(() => {}) }
}

function restrict(directory) {
  const command = `
$ErrorActionPreference = 'Stop'
$path = $env:TEAMSIGHT_ACL_TARGET
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid,'S-1-5-18','S-1-5-32-544')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]$identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
([IO.DirectoryInfo]::new($path)).SetAccessControl($acl)
`
  const executable = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    env: { ...process.env, TEAMSIGHT_ACL_TARGET: directory }, windowsHide: true, timeout: 15000,
  })
  if (result.status !== 0) fail('CODEX_ACL_FAILED')
}

async function configure(root) {
  const data = join(root, 'data-mcp'), statePath = join(root, 'installer-state.json')
  const config = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  safePath(statePath); safePath(config)
  const lock = join(root, '.installer-lock')
  try { fs.mkdirSync(lock) } catch { fail('INSTALLER_LOCKED') }
  try {
    const state = json(statePath)
    if (state.schema !== 2 || !samePath(root, state.base) || !samePath(process.execPath, state.node)) fail('INSTALLER_STATE_INVALID')
    const active = await connection(data, state.version, state.port)
    await mcpStatus(state.packageDir, active)
    const original = fs.existsSync(config) ? fs.readFileSync(config) : null
    const text = original?.toString('utf8').replace(/^\uFEFF/, '') ?? ''
    const previous = parseConfig(text).mcp_servers?.teamsight
    const receipt = { ok: true, instanceId: active.status.instanceId, codex: 'unchanged', reconnect: false }
    if (previous !== undefined) {
      if (previous?.url !== active.url || previous?.http_headers?.Authorization !== active.headers.Authorization) fail('CODEX_CONNECTION_CONFLICT')
      return receipt
    }
    const updated = configureCodex(text, active.url, active.headers.Authorization.slice(7))
    fs.mkdirSync(dirname(config), { recursive: true })
    const stage = fs.mkdtempSync(join(dirname(config), '.teamsight-')), staged = join(stage, 'config.toml')
    try {
      restrict(stage)
      if (original !== null) {
        const backup = join(root, 'backups', 'codex-' + randomUUID())
        safePath(backup); fs.mkdirSync(backup); restrict(backup)
        fs.writeFileSync(join(backup, 'config.toml'), original, { flag: 'wx' })
      }
      fs.writeFileSync(staged, updated, { flag: 'wx' })
      safePath(config)
      const current = fs.existsSync(config) ? fs.readFileSync(config) : null
      if (original === null ? current !== null : !current?.equals(original)) fail('CODEX_CONFIG_CHANGED_DURING_INSTALL')
      if (original === null) fs.linkSync(staged, config)
      else fs.renameSync(staged, config)
    } finally { fs.rmSync(staged, { force: true }); fs.rmdirSync(stage) }
    return { ...receipt, codex: 'updated', reconnect: true }
  } finally { fs.rmdirSync(lock) }
}

export async function windowsAgent([action, directory, data, version, port, extra]) {
  if (action === 'verify') return verifyWindowsPayload(directory, data, version, port)
  if (action === 'configure') return configure(directory)
  if (action === 'inspect') {
    for (const name of ['teamsight.sqlite', 'teamsight.sqlite-wal', 'teamsight.sqlite-shm']) safePath(join(data, name))
    inspectData(directory, data)
    return { ok: true }
  }
  const active = await connection(data, version, port)
  if (action === 'health') return active.status
  if (action === 'mcp') return mcpStatus(directory, active)
  if (action !== 'stop' || active.status.instanceId !== extra) fail('INSTANCE_IDENTITY_MISMATCH')
  const response = await fetch(new URL('/_internal/stop', active.url), { method: 'POST', headers: active.headers, redirect: 'error', signal: AbortSignal.timeout(5000) })
  const answer = await response.json()
  if (!response.ok || !answer.stopping || answer.instanceId !== extra) fail('SERVICE_STOP_FAILED')
  return { ok: true }
}
