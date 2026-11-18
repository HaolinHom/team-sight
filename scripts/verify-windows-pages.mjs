import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { createServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { X509Certificate } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { windowsPages } from './build-windows-pages.mjs'
import { digest } from './installer/main.mjs'
import { parseConfig } from './installer/config.mjs'

assert.equal(process.platform, 'win32')
assert.equal(process.arch, 'x64')
const repo = fileURLToPath(new URL('..', import.meta.url))
const [releaseArg, evidenceArg, version = '0.3.5', ...legacyArgs] = process.argv.slice(2)
const releases = resolve(releaseArg ?? join(repo, 'artifacts/releases', version))
const evidence = resolve(evidenceArg ?? join(repo, '.local/validation/windows-pages'))
const legacyReleases = legacyArgs.length ? legacyArgs.map(path => resolve(path)) : [join(repo, 'artifacts/releases/0.3.3')]
const oldNode = process.env.TEAMSIGHT_TEST_OLD_NODE
const codex = process.env.TEAMSIGHT_TEST_CODEX
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const pwsh = process.env.TEAMSIGHT_LEGACY_PWSH || join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe')
const git = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0]
const openssl = process.env.TEAMSIGHT_TEST_OPENSSL || join(dirname(dirname(git)), 'usr/bin/openssl.exe')
const working = fs.mkdtempSync(join(repo, '.local/windows-pages-validation-'))
fs.mkdirSync(evidence, { recursive: true })
const key = join(working, 'test-key.pem'), cert = join(working, 'test-cert.pem')
const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert,
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8', windowsHide: true })
assert.equal(generated.status, 0, generated.error?.message || generated.stderr)
const certBytes = fs.readFileSync(cert), pin = new X509Certificate(certBytes).fingerprint.replaceAll(':', '')
const archives = new Map(), scripts = new Map(), records = [], roots = new Map()
let requests = 0, mode = 'normal'
const fixture = createServer({ key: fs.readFileSync(key), cert: certBytes }, (request, response) => {
  const script = scripts.get(request.url)
  if (script) {
    const body = mode === 'script-truncated' ? script.subarray(0, script.length - 4) : script
    const type = request.url.endsWith('external.ps1') ? 'application/octet-stream' : 'text/plain; charset=utf-8'
    response.writeHead(200, { 'content-type': type, 'content-length': body.length }); response.end(body); return
  }
  requests++
  const file = archives.get(request.url)
  if (!file) { response.writeHead(404); response.end(); return }
  const size = fs.statSync(file).size
  response.writeHead(200, { 'content-type': 'application/zip', 'content-length': size })
  if (mode === 'zip-truncated') { response.end('partial'); return }
  if (mode === 'zip-corrupt') {
    response.write('not-a-zip')
    fs.createReadStream(file, { start: Buffer.byteLength('not-a-zip') }).pipe(response); return
  }
  fs.createReadStream(file).pipe(response)
})
await new Promise((ready, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', ready) })
const origin = `https://127.0.0.1:${fixture.address().port}`
const tls = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class TeamSightFixtureTls {
  public static bool Check(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) {
    var request = sender as HttpWebRequest;
    return request != null && request.RequestUri.IsLoopback && cert != null && cert.GetCertHashString() == "${pin}";
  }
  public static void Setup() { ServicePointManager.ServerCertificateValidationCallback = Check; }
}
'@
[TeamSightFixtureTls]::Setup()
`
const baseEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')), NODE_OPTIONS: '', NODE_PATH: '' }
const noPath = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => key.toLowerCase() !== 'path'))
const literal = value => "'" + value.replaceAll("'", "''") + "'"
const schedulerRoot = literal(String.fromCharCode(92))
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const stateFile = root => join(root, 'installer-state.json')
const tokenFile = root => join(root, 'data-mcp/access-token')
const taskName = root => 'TeamSight MCP-' + digest(root).slice(0, 12).toUpperCase()
const original = '# preserved\n[mcp_servers.unrelated]\nurl="https://example.test"\n'
const conflictText = original + '\n[mcp_servers.teamsight]\nurl="https://manual.test/mcp"\n'
const run = (command, args, env = baseEnv) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const timeout = setTimeout(() => { child.kill(); reject(Error('Fixture process timeout')) }, 180_000)
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.on('error', error => { clearTimeout(timeout); reject(error) })
  child.on('close', code => { clearTimeout(timeout); resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() }) })
})
const ps = (source, env) => run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; " + source, 'utf16le').toString('base64')], env)
function result(output, error = null, root = null) {
  if (root && fs.existsSync(tokenFile(root))) {
    const secret = fs.readFileSync(tokenFile(root), 'utf8').trim()
    assert.ok(!(`${output.stdout}\n${output.stderr}`).includes(secret), 'access token leaked')
  }
  if (error) {
    assert.notEqual(output.code, 0); assert.equal(output.stdout, '')
    assert.match(output.stderr, error); return
  }
  assert.equal(output.code, 0, output.stderr)
  return output.stdout
}
function record(name) { records.push({ name, result: 'passed' }); console.log('PASS ' + name) }
async function serveEntries(directory, release) {
  const site = join(working, release)
  await windowsPages(directory, site, release, { origin })
  for (const [variant, entry] of [['bundled', 'install-mcp.ps1'], ['external', 'install-mcp-external.ps1']]) {
    scripts.set(`/${release}/${entry}`, fs.readFileSync(join(site, entry)))
    const archive = `teamsight-mcp-${release}-win32-x64-${variant}.zip`
    archives.set(`/${archive}`, join(directory, archive))
  }
}
async function isolated(existingListener = false) {
  const root = fs.mkdtempSync(join(working, 'teamsight-installer-test-中文 spaces-'))
  const server = tcpServer().listen(0, '127.0.0.1')
  await new Promise((ready, reject) => { server.once('listening', ready); server.once('error', reject) })
  const port = server.address().port
  if (!existingListener) await new Promise(ready => server.close(ready))
  const home = join(root, 'codex home'), config = join(home, 'config.toml')
  fs.mkdirSync(home); fs.writeFileSync(config, original)
  const fixtureRoot = { root, port, home, config, server }
  roots.set(root, fixtureRoot)
  return fixtureRoot
}
async function install(at, { release = version, variant = 'bundled', path = dirname(process.execPath), error = null, failure = '' } = {}) {
  const entry = variant === 'bundled' ? 'install-mcp.ps1' : 'install-mcp-external.ps1'
  const config = fs.readFileSync(at.config)
  const env = { ...noPath, Path: path, CODEX_HOME: at.home, TEAMSIGHT_TEST_ROOT: at.root, TEAMSIGHT_TEST_PORT: String(at.port), TEAMSIGHT_TEST_FAIL: failure }
  const output = await ps(`${tls}\nirm ${literal(`${origin}/${release}/${entry}`)} | iex`, env)
  assert.ok(fs.readFileSync(at.config).equals(config), 'installation changed Codex config')
  assert.equal(fs.existsSync(join(at.root, '.installer-lock')), false)
  const text = result(output, error, at.root)
  if (!error) {
    const receipt = JSON.parse(text)
    assert.equal(receipt.ok, true); assert.equal(receipt.schema, 1); assert.equal(receipt.service, 'verified')
    assert.equal(receipt.credentialFile.toLowerCase(), tokenFile(at.root).toLowerCase())
    assert.equal(receipt.url, `http://127.0.0.1:${at.port}/mcp`)
    return receipt
  }
}
async function helper(at, receipt, error = null) {
  const output = await ps(`& ${literal(receipt.codexHelper)}; exit $LASTEXITCODE`, { ...baseEnv, CODEX_HOME: at.home })
  const text = result(output, error, at.root)
  if (!error) return JSON.parse(text)
}
async function status(at, stop = false) {
  const info = json(join(at.root, 'data-mcp/instance.json'))
  assert.equal(info.url, `http://127.0.0.1:${at.port}/mcp`)
  const token = fs.readFileSync(tokenFile(at.root), 'utf8').trim()
  const response = await fetch(new URL(stop ? '/_internal/stop' : '/health', info.url), {
    method: stop ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.ok, true)
  const active = await response.json()
  assert.equal(active.instanceId, info.instanceId)
  return active
}
async function acl(file) {
  const probe = `$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl = Get-Acl -LiteralPath ${literal(file)};
  $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
  if ($rules.Count -ne 3 -or @($rules | Where-Object { $_.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544') -or $_.AccessControlType -ne 'Allow' }).Count) { throw 'ACL_UNEXPECTED' }; 'ok'`
  assert.equal(result(await ps(probe)), 'ok')
}
async function verifyCodex(at, receipt) {
  const app = spawn(codex, ['app-server', '--listen', 'stdio://'], { env: { ...baseEnv, CODEX_HOME: at.home }, cwd: at.root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: app.stdout }), pending = new Map()
  let currentId = 0
  lines.on('line', line => { try { const message = JSON.parse(line); pending.get(message.id)?.(message) } catch {} })
  app.stdin.on('error', () => {})
  app.on('error', () => {})
  function request(method, params) {
    const id = ++currentId
    return new Promise((ready, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(Error('Codex RPC timeout: ' + method)) }, 45_000)
      pending.set(id, message => {
        clearTimeout(timeout); pending.delete(id)
        if (message.error) reject(Error(`Codex RPC failed: ${method} (${message.error.code})`))
        else ready(message.result)
      })
      app.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  try {
    await request('initialize', { clientInfo: { name: 'teamsight_windows_installer_test', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    app.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
    const { thread } = await request('thread/start', { cwd: at.root, ephemeral: true })
    const active = await request('mcpServer/tool/call', { threadId: thread.id, server: 'teamsight', tool: 'teamsight_status', arguments: {} })
    assert.equal(active.structuredContent?.instanceId, receipt.instanceId)
    assert.equal(active.structuredContent?.version, receipt.version)
    assert.ok(!active.isError)
  } finally { lines.close(); app.stdin.end(); app.kill() }
}
async function legacyInstall(at, directory, release) {
  const managerDir = join(working, 'legacy-manager-' + release)
  fs.mkdirSync(managerDir)
  const manager = join(managerDir, 'install-windows.ps1')
  const source = fs.readFileSync(join(repo, 'scripts/install-windows.ps1'), 'utf8').replaceAll('0.3.4-bundled', release + '-bundled')
  const helper = fs.readFileSync(join(repo, '.local/windows-manager/windows-config.cjs'), 'utf8').replace('!== "0.3.4"', `!== "${release}"`)
  fs.writeFileSync(manager, source); fs.writeFileSync(join(managerDir, 'windows-config.cjs'), helper)
  fs.copyFileSync(join(repo, '.local/windows-manager/THIRD-PARTY-LICENSES.txt'), join(managerDir, 'THIRD-PARTY-LICENSES.txt'))
  result(await run(pwsh, ['-NoProfile', '-NonInteractive', '-File', manager, '-Action', 'Install', '-PackagePath',
    join(directory, 'teamsight-mcp-win32-x64-bundled'), '-InstallRoot', at.root, '-CodexHome', at.home, '-Port', String(at.port)]), null, at.root)
  assert.equal((await status(at)).version, release)
}
async function dataProbe(at, command) {
  const state = json(stateFile(at.root)), cli = join(state.packageDir, 'dist/storage.js')
  const node = state.node ?? join(state.packageDir, 'runtime/node.exe')
  const module = 'import assert from "node:assert/strict"; import {pathToFileURL} from "node:url"; const {openStore}=await import(pathToFileURL(process.argv[1])); '
    + 'const store=openStore(process.argv[2]); try { const v=store.readSettings(); '
    + (command === 'seed' ? 'store.saveSettings({expectedRevision:v.revision,patch:{teamName:"fixture team"},credential:"TEAMSIGHT_WINDOWS_FIXTURE_ONLY"});'
      : command === 'clear' ? 'store.clearCredential();' : 'assert.equal(v.settings.teamName,"fixture team"); assert.equal(store.getCredential(),"TEAMSIGHT_WINDOWS_FIXTURE_ONLY");') + '} finally { store.close() }'
  result(await run(node, ['--input-type=module', '-e', module, cli, join(at.root, 'data-mcp')]), null, at.root)
}
async function cleanup(at) {
  assert.equal(dirname(at.root), working)
  if (at.server.listening) await new Promise(ready => at.server.close(ready))
  if (!fs.existsSync(stateFile(at.root))) return
  const state = json(stateFile(at.root))
  assert.equal(state.base, at.root); assert.equal(state.port, at.port); assert.equal(state.taskName, taskName(at.root))
  const query = `Get-ScheduledTask -TaskPath ${schedulerRoot} -TaskName ${literal(state.taskName)} -ErrorAction Stop`
  const validate = `$task = ${query}; if (@($task.Actions).Count -ne 1 -or $task.Actions.Arguments -cne ${literal(state.taskArguments)} -or $task.Actions.WorkingDirectory -ne ${literal(at.root)}) { throw 'FIXTURE_TASK_CHANGED' }; `
  result(await ps(validate + '$task | Disable-ScheduledTask | Out-Null'))
  if (fs.existsSync(join(at.root, 'data-mcp/instance.lock'))) await status(at, true)
  for (let attempt = 0; attempt < 60 && fs.existsSync(join(at.root, 'data-mcp/instance.lock')); attempt++) await delay(250)
  assert.ok(!fs.existsSync(join(at.root, 'data-mcp/instance.lock')))
  result(await ps(validate + '$task | Unregister-ScheduledTask -Confirm:$false'))
}

let environment, complete = false, failure = null
try {
  environment = JSON.parse(result(await ps(`@{ version=$PSVersionTable.PSVersion.ToString(); policy=(Get-ExecutionPolicy).ToString(); admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress`)))
  assert.match(environment.version, /^5\.1\./); assert.equal(environment.admin, false)
  await serveEntries(releases, version)
  for (const directory of legacyReleases) await serveEntries(directory, JSON.parse(fs.readFileSync(join(directory, 'teamsight-mcp-win32-x64-bundled/versions.json'))).version)

  for (const bad of ['script-truncated', 'zip-truncated', 'zip-corrupt']) {
    const at = await isolated(); mode = bad
    await install(at, { error: /Missing|Incomplete|ARCHIVE_|connection|Read|script block/i })
    assert.ok(!fs.existsSync(stateFile(at.root)))
    record(bad + ' rejected without a success receipt or installation')
  }
  mode = 'normal'
  const at = await isolated()
  await install(at, { variant: 'external', path: '', error: /NODE_MISSING/ })
  if (oldNode) await install(at, { variant: 'external', path: oldNode, error: /NODE_UNSUPPORTED/ })
  if (oldNode) record('missing and incompatible external Node refused')
  const first = await install(at, { path: '' })
  assert.equal(first.action, 'installed'); assert.equal(first.variant, 'bundled')
  assert.equal((await status(at)).instanceId, first.instanceId)
  await acl(first.credentialFile)
  const token = fs.readFileSync(first.credentialFile)
  const count = requests
  const again = await install(at, { path: '' })
  assert.equal(again.action, 'already-current'); assert.equal(again.instanceId, first.instanceId); assert.equal(requests, count)
  record('bundled HTTPS install with empty PATH, private ACL, persisted service and download-free repeat')

  fs.writeFileSync(at.config, conflictText)
  await helper(at, first, /CODEX_CONNECTION_CONFLICT/)
  assert.equal(fs.readFileSync(at.config, 'utf8'), conflictText)
  fs.writeFileSync(at.config, original)
  assert.equal((await helper(at, first)).codex, 'updated')
  assert.equal((await helper(at, first)).codex, 'unchanged')
  assert.equal(parseConfig(fs.readFileSync(at.config, 'utf8')).mcp_servers.unrelated.url, 'https://example.test')
  await acl(at.config)
  const backups = fs.readdirSync(join(at.root, 'backups')).filter(name => name.startsWith('codex-'))
  assert.equal(backups.length, 1)
  await acl(join(at.root, 'backups', backups[0], 'config.toml'))
  assert.equal(fs.readFileSync(join(at.root, 'backups', backups[0], 'config.toml'), 'utf8'), original)
  record('Codex helper conflict protection, unchanged repeat, isolated config and backup ACLs')
  if (codex) { await verifyCodex(at, first); record('isolated Codex app-server calls bundled teamsight_status') }

  await dataProbe(at, 'seed'); at.seeded = true
  const stateBefore = fs.readFileSync(stateFile(at.root))
  await install(at, { variant: 'external', error: /TEST_START_FAILURE/, failure: 'after-start' })
  assert.ok(fs.readFileSync(stateFile(at.root)).equals(stateBefore))
  assert.equal((await status(at)).version, version)
  await dataProbe(at, 'verify')
  record('post-start fault restores prior task/runtime/state and keeps Credential Manager entry')

  const external = await install(at, { variant: 'external' })
  assert.equal(external.action, 'variant-switched'); assert.equal(external.variant, 'external')
  assert.equal(fs.realpathSync(json(stateFile(at.root)).node).toLowerCase(), fs.realpathSync(process.execPath).toLowerCase())
  assert.ok(fs.readFileSync(tokenFile(at.root)).equals(token)); await dataProbe(at, 'verify')
  const oldest = [...scripts.keys()].find(path => !path.startsWith(`/${version}/`))?.split('/')[1]
  if (oldest) {
    const before = requests, newer = await install(at, { release: oldest, path: '' })
    assert.equal(newer.action, 'newer-local'); assert.equal(newer.instanceId, external.instanceId); assert.equal(requests, before)
    record('older entry validates newer local service without downloading or changing variant')
  }
  if (codex) { await verifyCodex(at, external); record('isolated Codex app-server calls external teamsight_status') }
  assert.equal((await install(at, { path: '' })).action, 'variant-switched')
  await dataProbe(at, 'verify'); assert.ok(fs.readFileSync(tokenFile(at.root)).equals(token))
  record('bidirectional switch keeps database/configuration, credential and access token')
  const cleanExternal = await isolated()
  assert.equal((await install(cleanExternal, { variant: 'external' })).action, 'installed')
  record('external edition installs into a clean root')

  const occupied = await isolated(true)
  await install(occupied, { error: /PORT_IN_USE/ }); assert.ok(occupied.server.listening)
  const unknown = await isolated()
  fs.mkdirSync(join(unknown.root, 'data-mcp')); fs.writeFileSync(join(unknown.root, 'data-mcp/instance.lock'), 'unknown')
  await install(unknown, { error: /UNMANAGED_SERVICE/ })
  assert.equal(fs.readFileSync(join(unknown.root, 'data-mcp/instance.lock'), 'utf8'), 'unknown')
  const conflictingTask = await isolated(), name = literal(taskName(conflictingTask.root))
  const taskRemoval = `Unregister-ScheduledTask -TaskPath ${schedulerRoot} -TaskName ${name} -Confirm:$false`
  result(await ps(`$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit'; Register-ScheduledTask -TaskPath ${schedulerRoot} -TaskName ${name} -Action $a | Out-Null`))
  try {
    await install(conflictingTask, { error: /UNMANAGED_SERVICE/ })
    assert.equal(result(await ps(`(Get-ScheduledTask -TaskPath ${schedulerRoot} -TaskName ${name}).Actions.Execute`)), 'cmd.exe')
  } finally { result(await ps(taskRemoval)) }
  record('occupied port, unknown lock and unrelated task are not taken over')

  for (const directory of legacyReleases) {
    const release = json(join(directory, 'teamsight-mcp-win32-x64-bundled/versions.json')).version
    const legacy = await isolated(); await legacyInstall(legacy, directory, release)
    const originalToken = fs.readFileSync(tokenFile(legacy.root)), originalState = fs.readFileSync(stateFile(legacy.root))
    await dataProbe(legacy, 'seed'); legacy.seeded = true
    await install(legacy, { variant: 'external', error: /TEST_START_FAILURE/, failure: 'after-start' })
    assert.equal((await status(legacy)).version, release); assert.ok(fs.readFileSync(stateFile(legacy.root)).equals(originalState))
    await dataProbe(legacy, 'verify')
    assert.equal((await install(legacy, { variant: 'external' })).action, 'upgraded')
    assert.ok(fs.readFileSync(tokenFile(legacy.root)).equals(originalToken)); await dataProbe(legacy, 'verify')
    record(`legacy ${release} scheduled service rollback and successful data-preserving upgrade`)
  }
  complete = true
} catch (error) { failure = error } finally {
  const errors = []
  for (const at of roots.values()) {
    if (at.seeded) { try { await dataProbe(at, 'clear') } catch (error) { errors.push(error) } }
    try { await cleanup(at) } catch (error) { errors.push(error) }
  }
  fixture.closeAllConnections(); await new Promise(ready => fixture.close(ready))
  fs.rmSync(key, { force: true })
  fs.writeFileSync(join(evidence, 'acceptance.json'), JSON.stringify({ ok: complete && !errors.length, environment, records, remoteTapdWrites: 0,
    codex: codex ? 'see records' : 'not requested', incompatibleNode: oldNode ? 'see records' : 'fixture unavailable', actualLogon: 'not tested',
    cleanup: errors.length ? 'failed' : 'passed', isolatedEvidenceRoot: working }, null, 2) + '\n')
  if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Isolated cleanup failed')
}
if (failure) throw failure
