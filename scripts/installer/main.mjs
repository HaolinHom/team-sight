import * as fs from 'node:fs'
import { join, dirname, resolve, isAbsolute, basename } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { configureCodex, deleteConfigPath, parseConfig } from './config.mjs'

export const digest = value => createHash('sha256').update(value).digest('hex')
const exists = fs.existsSync
const json = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const fail = code => { throw new Error(code) }
function safePath(path) {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (exists(p) && fs.lstatSync(p).isSymbolicLink()) fail('SYMLINK_PATH_REFUSED')
    if (p === dirname(p)) break
  }
}
function directory(path) { safePath(path); fs.mkdirSync(path, { recursive: true, mode: 0o700 }) }
function atomic(path, content, mode = 0o600) {
  safePath(path); directory(dirname(path))
  const temp = path + '.' + randomUUID() + '.tmp'
  try { fs.writeFileSync(temp, content, { mode, flag: 'wx' }); fs.renameSync(temp, path) }
  finally { fs.rmSync(temp, { force: true }) }
}
function run(command, args, code, timeout = 120_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } })
  if (result.error || result.status !== 0) fail(code)
  return result.stdout
}
const shell = value => "'" + value.replaceAll("'", "'\\''") + "'"
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
export function verifyPayload(path) {
  path = resolve(path)
  const expected = json(join(path, 'checksums.json')), seen = new Set()
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = join(dir, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) fail('PAYLOAD_SYMLINK_OR_SPECIAL_FILE')
      if (stat.isDirectory()) walk(file)
      else {
        const key = file.slice(path.length + 1)
        if (key === 'checksums.json') continue
        if (digest(fs.readFileSync(file)) !== expected[key]) fail('PAYLOAD_HASH_MISMATCH: ' + key)
        seen.add(key)
      }
    }
  }
  walk(path)
  if (seen.size !== Object.keys(expected).length) fail('PAYLOAD_FILE_SET_MISMATCH')
  return json(join(path, 'versions.json'))
}
export function inspectData(packageDir, dataDir) {
  if (exists(join(dataDir, '.migration')) || exists(join(dataDir, 'probe.sqlite'))) fail('DATA_MIGRATION_REQUIRED')
  if (!exists(join(dataDir, 'teamsight.sqlite'))) return
  safePath(join(dataDir, 'teamsight.sqlite'))
  const require = createRequire(join(packageDir, 'package.json'))
  const Database = require('better-sqlite3')
  const db = new Database(join(dataDir, 'teamsight.sqlite'), { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('user_version', { simple: true }) !== 4) fail('DATA_SCHEMA_UNSUPPORTED')
    if (JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value).schemaVersion !== 6) fail('SETTINGS_SCHEMA_UNSUPPORTED')
    if (db.prepare("SELECT count(*) AS n FROM jobs WHERE status='running'").get().n || db.prepare("SELECT count(*) AS n FROM operations WHERE status IN ('pending','in_flight')").get().n) fail('SERVICE_BUSY: finish active jobs and pending writes before retrying')
  } finally { db.close() }
}
export function paths(base, codexHome, testing = false, port = 43127) {
  base = resolve(base); codexHome = resolve(codexHome)
  const label = 'cn.teamsight.mcp' + (testing ? '.test.' + digest(base).slice(0, 16) : '')
  return { base, codexHome, label, port, data: join(base, 'data-mcp'), state: join(base, 'installer-state.json'), start: join(base, 'start.sh'),
    plist: testing ? join(base, 'launchagents', label + '.plist') : join(homedir(), 'Library/LaunchAgents', label + '.plist'),
    config: join(codexHome, 'config.toml'), domain: 'gui/' + process.getuid(), logs: join(base, 'logs') }
}
function loaded(p) { return spawnSync('/bin/launchctl', ['print', p.domain + '/' + p.label], { stdio: 'ignore' }).status === 0 }
function ownedState(p) {
  if (!exists(p.state)) return null
  safePath(p.state)
  if (fs.statSync(p.state).uid !== process.getuid()) fail('INSTALLER_STATE_OWNER_MISMATCH')
  const state = json(p.state)
  if (state.schema !== 1 || state.base !== p.base || state.codexHome !== p.codexHome || state.label !== p.label || state.plist !== p.plist || state.data !== p.data || state.port !== p.port) fail('INSTALLER_STATE_MISMATCH')
  if (!['bundled', 'external'].includes(state.variant) || state.version !== '0.3.3' || state.packageDir !== join(p.base, 'versions', state.version + '-' + state.variant)) fail('INSTALLER_STATE_MISMATCH')
  safePath(state.packageDir)
  for (const [path, hash] of [[p.start, state.startHash], [p.plist, state.plistHash]]) if (!exists(path) || digest(fs.readFileSync(path)) !== hash) fail('MANAGED_SERVICE_CHANGED')
  for (const name of state.ownedPackages) if (!/^0\.3\.3-(bundled|external)$/.test(name)) fail('INSTALLER_STATE_MISMATCH')
  return state
}
async function health(p, state) {
  const info = json(join(p.data, 'instance.json')), token = fs.readFileSync(join(p.data, 'access-token'), 'utf8').trim()
  const expectedUrl = 'http://127.0.0.1:' + p.port + '/mcp'
  if (!/^[a-f0-9]{64}$/.test(token) || info.url !== expectedUrl || resolve(info.dataDir) !== p.data) fail('INSTANCE_IDENTITY_MISMATCH')
  const response = await fetch('http://127.0.0.1:' + p.port + '/health', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(2000) })
  if (!response.ok) fail('SERVICE_HEALTH_FAILED')
  const value = await response.json()
  if (value.instanceId !== info.instanceId || value.pid !== info.pid || value.version !== '0.3.3') fail('INSTANCE_IDENTITY_MISMATCH')
  const command = run('/bin/ps', ['-p', String(info.pid), '-o', 'command='], 'INSTANCE_PROCESS_MISSING')
  if (!command.includes(join(state.packageDir, 'dist/cli.js')) || !command.includes(p.data)) fail('INSTANCE_PROCESS_MISMATCH')
  return { value, token, url: expectedUrl }
}
async function mcpStatus(packageDir, connection) {
  const require = createRequire(join(packageDir, 'package.json'))
  const { Client, StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')).href)
  const client = new Client({ name: 'teamsight-http-installer', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: 'Bearer ' + connection.token }, signal: AbortSignal.timeout(15000) } })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    const result = await client.callTool({ name: 'teamsight_status', arguments: {} })
    if (tools.tools.length !== 37 || result.isError || result.structuredContent?.instanceId !== connection.value.instanceId || result.structuredContent?.version !== '0.3.3') fail('MCP_VERIFICATION_FAILED')
    return { version: result.structuredContent.version, tools: tools.tools.length }
  } finally { await transport.terminateSession().catch(() => {}); await client.close().catch(() => {}) }
}
let cancelled = false
const checkCancelled = () => { if (cancelled) fail('INSTALL_CANCELLED') }
async function waitFor(operation, code) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    checkCancelled()
    try { if (await operation()) return } catch {}
    await new Promise(ok => setTimeout(ok, 500))
  }
  fail(code)
}
async function stop(p, state) {
  const running = loaded(p)
  if (exists(join(p.data, 'instance.lock'))) {
    if (!running) fail('UNMANAGED_INSTANCE: do not remove instance.lock')
    await health(p, state)
  }
  inspectData(state.packageDir, p.data)
  if (running) {
    run('/bin/launchctl', ['bootout', p.domain + '/' + p.label], 'LAUNCHAGENT_STOP_FAILED', 30_000)
    await waitFor(() => !exists(join(p.data, 'instance.lock')), 'SERVICE_STOP_TIMEOUT')
  }
  if (exists(join(p.data, 'instance.lock'))) fail('INSTANCE_LOCK_REMAINS')
}
function bootstrap(p) { run('/bin/launchctl', ['bootstrap', p.domain, p.plist], 'LAUNCHAGENT_START_FAILED', 30_000) }
function snapshot(path) { safePath(path); return exists(path) ? fs.readFileSync(path) : null }
function restore(path, bytes, mode = 0o600) { if (bytes === null) fs.rmSync(path, { force: true }); else atomic(path, bytes, mode) }
function backup(p, snapshots) {
  const dir = join(p.base, 'backups', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8))
  directory(dir)
  for (const [name, bytes] of Object.entries(snapshots)) if (bytes !== null) atomic(join(dir, name), bytes)
  if (exists(p.data)) {
    const copy = (from, to) => {
      const stat = fs.lstatSync(from)
      if (stat.isSymbolicLink()) fail('DATA_BACKUP_SYMLINK_REFUSED')
      if (stat.isDirectory()) { directory(to); for (const name of fs.readdirSync(from)) copy(join(from, name), join(to, name)) }
      else { fs.copyFileSync(from, to); fs.chmodSync(to, 0o600); if (digest(fs.readFileSync(from)) !== digest(fs.readFileSync(to))) fail('DATA_BACKUP_HASH_MISMATCH') }
    }
    copy(p.data, join(dir, 'data-mcp'))
  }
  return dir
}
export async function perform(options) {
  const { mode, base, codexHome, testing, port, payload, node, version, variant } = options
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node.split('.')[0] !== '22' || Number(process.versions.node.split('.')[1]) < 14 || Number(process.versions.napi) < 10) fail('NODE_OR_PLATFORM_UNSUPPORTED')
  if (version !== '0.3.3' || !['bundled', 'external'].includes(variant)) fail('UNSUPPORTED_RELEASE')
  const p = paths(base, codexHome, testing, port)
  if (testing && (!basename(p.base).startsWith('teamsight-installer-test-') || p.base === resolve(homedir()))) fail('INVALID_TEST_ROOT')
  safePath(p.base); safePath(p.config); safePath(p.plist); safePath(p.data)
  if (mode !== 'install' && !exists(p.state)) fail('NO_MANAGED_INSTALLATION')
  directory(p.base)
  const lock = join(p.base, '.installer-lock')
  try { fs.mkdirSync(lock, { mode: 0o700 }) } catch { fail('INSTALLER_LOCKED: another installer may be running') }
  try {
    const old = ownedState(p), oldLoaded = loaded(p)
    if (!old && (oldLoaded || exists(p.plist) || exists(p.start) || exists(join(p.data, 'instance.lock')))) fail('UNMANAGED_SERVICE: inspect the existing service before installing')
    if (mode === 'status') {
      const connection = await health(p, old), mcp = await mcpStatus(old.packageDir, connection)
      return { ok: true, service: 'verified', ...mcp, variant: old.variant, node: connection.value.node, codex: 'reconnect-required-unless-already-connected' }
    }
    const oldConfig = snapshot(p.config), original = oldConfig?.toString('utf8') ?? ''
    parseConfig(original)
    if (mode === 'uninstall') {
      const target = parseConfig(original).mcp_servers?.teamsight
      const token = fs.readFileSync(join(p.data, 'access-token'), 'utf8').trim()
      if (target?.url !== 'http://127.0.0.1:' + p.port + '/mcp' || target?.http_headers?.Authorization !== 'Bearer ' + token) fail('CODEX_CONNECTION_CHANGED: preserve the modified connection')
      const next = deleteConfigPath(original, ['mcp_servers', 'teamsight'])
      parseConfig(next)
      const savedStart = snapshot(p.start), savedPlist = snapshot(p.plist), savedState = snapshot(p.state), moved = []
      let didStop = false, written = false
      try {
        await stop(p, old); didStop = true
        backup(p, { 'config.toml': oldConfig, 'start.sh': savedStart, 'launchagent.plist': savedPlist, 'installer-state.json': savedState })
        if (!snapshot(p.config)?.equals(oldConfig)) fail('CODEX_CONFIG_CHANGED_DURING_INSTALL')
        for (const name of old.ownedPackages) {
          const from = join(p.base, 'versions', name), to = from + '.uninstall-' + randomUUID()
          if (exists(from)) { fs.renameSync(from, to); moved.push({ from, to }) }
        }
        atomic(p.config, next); written = true
        if (testing && process.env.TEAMSIGHT_INSTALL_TEST_FAIL === 'uninstall') fail('TEST_UNINSTALL_FAILURE')
        fs.rmSync(p.plist); fs.rmSync(p.start); fs.rmSync(p.state)
      } catch (error) {
        for (const item of moved.reverse()) fs.renameSync(item.to, item.from)
        if (written && snapshot(p.config)?.toString('utf8') === next) restore(p.config, oldConfig)
        restore(p.start, savedStart, 0o700); restore(p.plist, savedPlist); restore(p.state, savedState)
        if (didStop && oldLoaded) { bootstrap(p); await waitFor(() => health(p, old).then(() => true), 'ROLLBACK_RESTART_FAILED') }
        throw error
      }
      for (const item of moved) fs.rmSync(item.to, { recursive: true, force: true })
      return { ok: true, service: 'uninstalled', data: 'preserved', credentials: 'preserved', codex: 'reconnect-required' }
    }
    const manifest = verifyPayload(payload)
    if (manifest.version !== version || manifest.variant !== variant || manifest.target !== 'darwin-arm64') fail('PAYLOAD_RELEASE_MISMATCH')
    inspectData(payload, p.data)
    const target = join(p.base, 'versions', version + '-' + variant)
    safePath(target)
    let created = false, stopped = false, touched = false, newLoaded = false, writtenConfig = null
    const snapshots = { 'config.toml': oldConfig, 'start.sh': snapshot(p.start), 'launchagent.plist': snapshot(p.plist), 'installer-state.json': snapshot(p.state) }
    if (exists(target)) {
      verifyPayload(target)
      if (digest(fs.readFileSync(join(target, 'checksums.json'))) !== digest(fs.readFileSync(join(payload, 'checksums.json')))) fail('EXISTING_PACKAGE_MISMATCH')
    }
    try {
      if (!exists(target)) {
        directory(dirname(target))
        const stage = target + '.staging-' + randomUUID()
        try { fs.cpSync(payload, stage, { recursive: true, dereference: false, errorOnExist: true, force: false }); verifyPayload(stage); fs.renameSync(stage, target) }
        finally { fs.rmSync(stage, { recursive: true, force: true }) }
        created = true
      }
      const runtime = variant === 'bundled' ? join(target, 'runtime/node') : fs.realpathSync(node)
      const cli = args => variant === 'bundled' ? run(join(target, 'launch.sh'), args, 'NATIVE_OR_MCP_DIAGNOSTIC_FAILED') : run(runtime, [join(target, 'dist/cli.js'), ...args], 'NATIVE_OR_MCP_DIAGNOSTIC_FAILED')
      console.log('TeamSight: checking SQLite, Keychain and PNG (doctor).')
      const doctor = JSON.parse(cli(['doctor']).trim())
      if (!doctor.ok || !doctor.keyringMatches || !doctor.pngBytes) fail('DOCTOR_FAILED')
      const evidence = join(p.base, 'validation', randomUUID())
      directory(evidence)
      run(runtime, [join(target, 'verify-mcp.mjs'), '--evidence-dir', evidence], 'ISOLATED_MCP_FAILED')
      checkCancelled()
      if (old) { await stop(p, old); stopped = true }
      else {
        const net = await import('node:net')
        await new Promise((ok, no) => { const server = net.createServer(); server.once('error', () => no(new Error('PORT_IN_USE'))); server.listen(p.port, '127.0.0.1', () => server.close(ok)) })
      }
      backup(p, snapshots)
      checkCancelled()
      directory(p.logs)
      const command = variant === 'bundled' ? shell(join(target, 'launch.sh')) : shell(runtime) + ' ' + shell(join(target, 'dist/cli.js'))
      const start = '#!/bin/sh\nset -eu\nunset NODE_OPTIONS NODE_PATH\nexec ' + command + ' serve --data-dir ' + shell(p.data) + ' --port ' + p.port + '\n'
      const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>' + xml(p.label) + '</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>' + xml(p.start) + '</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>WorkingDirectory</key><string>' + xml(target) + '</string><key>StandardOutPath</key><string>' + xml(join(p.logs, 'service.log')) + '</string><key>StandardErrorPath</key><string>' + xml(join(p.logs, 'service-error.log')) + '</string></dict></plist>\n'
      touched = true
      atomic(p.start, start, 0o700); atomic(p.plist, plist)
      run('/usr/bin/plutil', ['-lint', p.plist], 'LAUNCHAGENT_PLIST_INVALID')
      const state = { schema: 1, version, variant, base: p.base, codexHome: p.codexHome, label: p.label, plist: p.plist, data: p.data, port: p.port, packageDir: target, node: runtime,
        startHash: digest(start), plistHash: digest(plist), ownedPackages: [...new Set([...(old?.ownedPackages ?? []), ...(created ? [version + '-' + variant] : [])])] }
      bootstrap(p); newLoaded = true
      let connection
      await waitFor(async () => { connection = await health(p, state); return true }, 'SERVICE_START_TIMEOUT')
      const mcp = await mcpStatus(target, connection)
      if (testing && process.env.TEAMSIGHT_INSTALL_TEST_FAIL === 'after-start') fail('TEST_START_FAILURE')
      const configured = configureCodex(original, connection.url, connection.token)
      if ((snapshot(p.config)?.toString('utf8') ?? '') !== original) fail('CODEX_CONFIG_CHANGED_DURING_INSTALL')
      atomic(p.config, configured)
      writtenConfig = Buffer.from(configured)
      if (testing && process.env.TEAMSIGHT_INSTALL_TEST_FAIL === 'after-config') fail('TEST_CONFIG_FAILURE')
      atomic(p.state, JSON.stringify(state, null, 2) + '\n')
      return { ok: true, service: 'verified', ...mcp, variant, node: connection.value.node, codexConfiguration: 'updated', codexConnection: 'reconnect-required', nativeApps: 'pending-host-validation' }
    } catch (error) {
      cancelled = false // Rollback must finish even after an interrupt.
      try {
        if (newLoaded || touched && loaded(p)) {
          run('/bin/launchctl', ['bootout', p.domain + '/' + p.label], 'ROLLBACK_STOP_FAILED', 30_000)
          await waitFor(() => !exists(join(p.data, 'instance.lock')), 'ROLLBACK_STOP_TIMEOUT')
        }
        if (touched) {
          // Never overwrite a config concurrently edited by the user or another Agent.
          const current = snapshot(p.config)
          if (writtenConfig && current?.equals(writtenConfig)) restore(p.config, oldConfig)
          restore(p.start, snapshots['start.sh'], 0o700); restore(p.plist, snapshots['launchagent.plist']); restore(p.state, snapshots['installer-state.json'])
        }
        if (stopped && oldLoaded) { bootstrap(p); await waitFor(() => health(p, old).then(() => true), 'ROLLBACK_RESTART_FAILED') }
        if (created) fs.rmSync(target, { recursive: true, force: true })
      } catch { fail('ROLLBACK_REQUIRED: preserve backups and inspect the managed service') }
      throw error
    }
  } finally { fs.rmSync(lock, { recursive: true, force: true }) }
}
export async function main(args) {
  const [mode, base, codexHome, payload, node, version, variant, testFlag, port] = args
  process.on('SIGINT', () => { cancelled = true }); process.on('SIGTERM', () => { cancelled = true })
  return perform({ mode, base, codexHome, payload, node, version, variant, testing: testFlag === 'test', port: Number(port) })
}
