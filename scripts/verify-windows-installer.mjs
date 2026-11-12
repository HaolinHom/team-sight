// Real user-level task acceptance, isolated from the installed service and Codex config.
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { parseConfig } from './installer/config.mjs'
if (process.platform !== 'win32') throw Error('WINDOWS_REQUIRED')
const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = resolve(process.argv[2] ?? join(root, 'artifacts/validation/windows/installer'))
fs.mkdirSync(evidence, { recursive: true })
const base = fs.mkdtempSync(join(root, '.local/teamsight-installer-test-中文 spaces-'))
const codex = join(base, 'codex'), config = join(codex, 'config.toml')
const manager = join(root, '.local/windows-manager/install-windows.ps1')
const shell = process.env.TEAMSIGHT_POWERSHELL || join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe')
const payload = join(root, 'artifacts/releases/0.3.3/teamsight-mcp-win32-x64-bundled')
const records = []
const portServer = createServer(); await new Promise(ok => portServer.listen(0, '127.0.0.1', ok))
const port = portServer.address().port; await new Promise(ok => portServer.close(ok))
fs.mkdirSync(codex, { recursive: true })
const original = '# retained\n[mcp_servers.other]\nurl="https://example.test"\n'
fs.writeFileSync(config, original)
function run(action, success = true) {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', manager, '-Action', action, '-PackagePath', payload, '-InstallRoot', base, '-CodexHome', codex, '-Port', String(port)], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  assert.equal(result.error, undefined, result.error?.message)
  if (success) assert.equal(result.status, 0, result.stderr || result.stdout)
  else assert.notEqual(result.status, 0)
  const tokenPath = join(base, 'data-mcp/access-token')
  if (fs.existsSync(tokenPath)) assert.ok(!(result.stdout + result.stderr).includes(fs.readFileSync(tokenPath, 'utf8').trim()), 'credential leaked to output')
  return result
}
function record(name) { records.push({ name, result: 'passed' }); console.log('PASS ' + name) }
try {
  fs.writeFileSync(config, 'broken=["private-sentinel"')
  run('Install', false)
  assert.equal(fs.existsSync(join(base, 'installer-state.json')), false)
  assert.equal(fs.existsSync(join(base, 'data-mcp/instance.lock')), false)
  assert.equal(fs.existsSync(join(base, 'versions/0.3.3-bundled')), false)
  assert.equal(fs.readFileSync(config, 'utf8'), 'broken=["private-sentinel"')
  record('config failure rolls back the started service, task and new package')
  fs.writeFileSync(config, original)
  run('Install')
  const first = JSON.parse(run('Status').stdout)
  assert.equal(first.task, 'Running'); assert.equal(first.service.node, '22.23.4')
  assert.equal(parseConfig(fs.readFileSync(config, 'utf8')).mcp_servers.other.url, 'https://example.test')
  const token = fs.readFileSync(join(base, 'data-mcp/access-token'), 'utf8')
  record('hidden user task survives installer exit, config preserves other connections')
  run('Install'); assert.equal(JSON.parse(run('Status').stdout).service.instanceId, first.service.instanceId)
  run('Stop'); assert.equal(JSON.parse(run('Status').stdout).service, null)
  run('Start'); assert.notEqual(JSON.parse(run('Status').stdout).service.instanceId, first.service.instanceId)
  assert.equal(fs.readFileSync(join(base, 'data-mcp/access-token'), 'utf8'), token)
  record('idempotent install, stop, start and shared token preservation')
  run('Uninstall')
  assert.equal(fs.existsSync(join(base, 'installer-state.json')), false)
  assert.equal(fs.existsSync(join(base, 'data-mcp/instance.lock')), false)
  assert.equal(fs.existsSync(join(base, 'data-mcp/teamsight.sqlite')), true)
  assert.equal(fs.readFileSync(join(base, 'data-mcp/access-token'), 'utf8'), token)
  assert.equal(parseConfig(fs.readFileSync(config, 'utf8')).mcp_servers.teamsight, undefined)
  record('uninstall preserves database and token, removes only matching Codex connection')
  fs.writeFileSync(join(base, 'data-mcp/instance.lock'), 'unknown')
  assert.match(run('Install', false).stderr, /UNMANAGED_INSTANCE/)
  assert.equal(fs.readFileSync(join(base, 'data-mcp/instance.lock'), 'utf8'), 'unknown')
  fs.rmSync(join(base, 'data-mcp/instance.lock'))
  record('unknown instance lock is refused and preserved')
  const occupied = createServer(); await new Promise(ok => occupied.listen(port, '127.0.0.1', ok))
  try { assert.match(run('Install', false).stderr, /PORT_IN_USE/) } finally { await new Promise(ok => occupied.close(ok)) }
  record('occupied port is refused without stopping its owner')
  fs.writeFileSync(join(evidence, 'acceptance.json'), JSON.stringify({ ok: true, platform: process.platform, node: process.versions.node, records, isolatedRoot: base, actualLogon: 'not tested', reboot: 'not tested', remoteTapdWrites: 0 }, null, 2))
} finally {
  if (fs.existsSync(join(base, 'installer-state.json'))) run('Uninstall')
  // Keep isolated data and backups protected for inspection; no secret content is logged.
}
