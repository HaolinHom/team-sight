// Real HTTPS/native/launchd acceptance. Only isolated roots and test labels are used.
import * as fs from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'
import { digest, paths } from './installer/main.mjs'
import { parseConfig } from './installer/config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = resolve(process.argv[2] ?? '.local/validation/http-installer/acceptance')
const agentSite = process.argv[3] && resolve(process.argv[3])
fs.mkdirSync(evidence, { recursive: true })
const testBase = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'teamsight-installer-test-')))
const ca = join(testBase, 'ca.pem'), key = join(testBase, 'key.pem'), config = join(testBase, 'openssl.cnf')
fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n')
assert.equal(spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', ca, '-days', '1', '-config', config], { stdio: 'ignore' }).status, 0)
let responseMode = 'normal', packageRequests = 0
const previousSite = join(testBase, 'previous-site')
const sockets = new Set(), records = [], roots = new Set()
const fixture = createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(ca) }, (req, res) => {
  if (agentSite && /^\/(?:previous\/)?install-mcp(?:-external)?$/.test(req.url)) {
    const script = fs.readFileSync(join(req.url.startsWith('/previous/') ? previousSite : agentSite, req.url.split('/').pop()))
    const body = responseMode === 'script-truncated' ? script.subarray(0, script.length - 4) : script
    res.writeHead(200, { 'content-length': body.length }); res.end(body); return
  }
  packageRequests += 1
  if (responseMode === '404') { res.writeHead(404); res.end(); return }
  if (responseMode === 'timeout') return
  if (responseMode === 'corrupt') { res.end('corrupt'); return }
  const name = req.url.slice(1)
  const version = /^teamsight-mcp-(0\.3\.[345])-darwin-arm64-(bundled|external)\.tar\.gz$/.exec(name)?.[1]
  if (!version) { res.writeHead(404); res.end(); return }
  const path = join(root, 'artifacts/releases', version, name)
  if (!fs.existsSync(path)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-length': fs.statSync(path).size })
  if (responseMode === 'interrupted') { res.write('partial'); res.destroy(); return }
  fs.createReadStream(path).pipe(res)
})
fixture.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise(ok => fixture.listen(0, '127.0.0.1', ok))
const baseUrl = 'https://127.0.0.1:' + fixture.address().port
const externalNode = join(root, 'artifacts/releases/0.3.4/teamsight-mcp-darwin-arm64-bundled/runtime/node')
function newRoot() {
  const original = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'teamsight-installer-test-'))), path = original + ' with spaces'
  fs.renameSync(original, path); roots.add(path); return path
}
async function freePort() {
  const server = tcpServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port
}
async function installer(testRoot, port, args = [], extraEnv = {}, success = true, script = join(root, 'scripts/install.sh')) {
  const output = await new Promise(ok => {
    const child = spawn('/bin/bash', [script, '--test-root', testRoot, '--test-base-url', baseUrl, '--test-ca', ca, '--test-port', String(port), ...args],
      { env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''; child.stdout.on('data', bytes => { text += bytes }); child.stderr.on('data', bytes => { text += bytes })
    child.on('close', code => ok({ code, text }))
  })
  const tokenPath = join(testRoot, 'data-mcp/access-token')
  if (fs.existsSync(tokenPath)) assert.ok(!output.text.includes(fs.readFileSync(tokenPath, 'utf8').trim()), 'secret must not appear in output')
  if (success) assert.equal(output.code, 0, output.text)
  else assert.notEqual(output.code, 0, 'expected failure')
  return output
}
async function agentInstall(testRoot, port, { variant = 'bundled', older = false, extraEnv = {}, error } = {}) {
  const endpoint = baseUrl + (older ? '/previous' : '') + '/install-mcp' + (variant === 'external' ? '-external' : '')
  const command = '/usr/bin/curl --disable -fsS --cacert "$1" "$2" | /bin/sh -s -- --test "$3" "$4" "$1" "$5"'
  const result = await new Promise(ok => {
    const child = spawn('/bin/bash', ['-o', 'pipefail', '-c', command, 'fixture', ca, endpoint, testRoot, baseUrl, String(port)],
      { env: { ...process.env, PATH: '/usr/bin:/bin', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
    child.on('close', code => ok({ code, stdout, stderr }))
  })
  const tokenPath = join(testRoot, 'data-mcp/access-token')
  if (fs.existsSync(tokenPath)) assert.ok(!(result.stdout + result.stderr).includes(fs.readFileSync(tokenPath, 'utf8').trim()), 'secret must not appear in output')
  if (error) {
    assert.notEqual(result.code, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, error)
    return
  }
  assert.equal(result.code, 0, result.stderr)
  const value = JSON.parse(result.stdout)
  assert.equal(value.ok, true); assert.equal(value.schema, 1); assert.equal(value.service, 'verified')
  assert.equal(value.url, `http://127.0.0.1:${port}/mcp`); assert.equal(value.credentialFile, tokenPath)
  assert.equal(value.codexHelper, join(testRoot, 'configure-codex'))
  assert.match(value.next, /teamsight_status/)
  return value
}
function record(name, result = 'passed') { records.push({ name, result }); console.log('PASS ' + name) }
async function verifyCodexConnection(executable, install, testRoot) {
  const cwd = join(testRoot, 'host-fixture'), configHome = join(cwd, 'config')
  fs.mkdirSync(configHome, { recursive: true })
  const env = { ...process.env, CODEX_HOME: configHome }
  assert.equal(spawnSync(install.codexHelper, [], { env, encoding: 'utf8' }).status, 0, 'could not configure isolated Codex host')
  const codex = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] })
  const responses = createInterface({ input: codex.stdout }), requests = new Map()
  let id = 0
  responses.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    requests.get(message.id)?.(message)
  })
  codex.stdin.on('error', () => {})
  codex.on('error', () => {})
  function request(method, params) {
    const requestId = ++id
    return new Promise((resolveResponse, reject) => {
      const timeout = setTimeout(() => { requests.delete(requestId); reject(new Error('Codex RPC timeout: ' + method)) }, 45_000)
      requests.set(requestId, message => {
        clearTimeout(timeout); requests.delete(requestId)
        if (message.error) reject(new Error(`Codex RPC failed: ${method} (${message.error.code})`))
        else resolveResponse(message.result)
      })
      codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
    })
  }
  try {
    await request('initialize', { clientInfo: { name: 'teamsight_installer_test', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
    const thread = (await request('thread/start', { cwd, ephemeral: true })).thread
    const status = await request('mcpServer/tool/call', { threadId: thread.id, server: 'teamsight', tool: 'teamsight_status', arguments: {} })
    assert.ok(!status.isError); assert.equal(status.structuredContent?.instanceId, install.instanceId); assert.equal(status.structuredContent?.version, install.version)
  } finally {
    responses.close(); codex.stdin.end(); codex.kill()
  }
}
try {
  for (const mode of ['404', 'timeout', 'corrupt', 'interrupted']) {
    responseMode = mode; const dir = newRoot(), port = await freePort()
    const result = await installer(dir, port, [], {}, false)
    assert.match(result.text, mode === 'corrupt' ? /ARCHIVE_HASH_MISMATCH/ : /DOWNLOAD_FAILED/)
    assert.ok(!fs.existsSync(join(dir, 'installer-state.json')))
    assert.ok(!fs.existsSync(join(dir, '.installer-lock')))
    record('HTTPS ' + mode + ' rejects without installation')
  }
  responseMode = 'normal'
  {
    const dir = newRoot(), port = await freePort()
    assert.match((await installer(dir, port, ['--variant', 'external'], {}, false)).text, /NODE_MISSING/)
    const bad = join(dir, 'node'); fs.writeFileSync(bad, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    assert.match((await installer(dir, port, ['--variant', 'external', '--node', bad], {}, false)).text, /NODE_UNSUPPORTED/)
    record('external missing and incompatible Node diagnosis')
  }
  const dir = newRoot(), port = await freePort(), p = paths(dir, join(dir, 'codex'), true, port)
  fs.mkdirSync(p.codexHome)
  const original = '# user comment\nmodel="fixture"\n[mcp_servers.other]\nurl="https://example.test"\n[mcp_servers.teamsight]\nurl="http://old.invalid"\nbearer_token_env_var="OLD"\ndefault_tools_approval_mode="prompt"\n[mcp_servers.teamsight.tools.write]\napproval_mode="prompt"\n'
  fs.writeFileSync(p.config, original)
  const installed = await installer(dir, port, [], { NODE_OPTIONS: '--invalid-option', NODE_PATH: '/nonexistent' })
  assert.match(installed.text, /"service":"verified"/)
  let state = JSON.parse(fs.readFileSync(p.state)), connection = parseConfig(fs.readFileSync(p.config, 'utf8'))
  assert.equal(connection.mcp_servers.teamsight.default_tools_approval_mode, 'prompt')
  assert.equal(connection.mcp_servers.teamsight.tools.write.approval_mode, 'prompt')
  assert.equal(fs.statSync(p.config).mode & 0o777, 0o600)
  assert.equal(fs.statSync(p.state).mode & 0o777, 0o600)
  assert.equal(spawnSync('/usr/bin/xattr', ['-r', join(dir, 'versions/0.3.4-bundled')], { encoding: 'utf8' }).stdout.includes('com.apple.quarantine'), false)
  await installer(dir, port, ['--status']) // installer process/terminal has already exited
  record('bundled install without system Node, diagnostics, permissions, isolated MCP, live tool catalog and detached launchd service')
  const token = fs.readFileSync(join(p.data, 'access-token')), db = join(p.data, 'teamsight.sqlite')
  const require = createRequire(join(state.packageDir, 'package.json')), Database = require('better-sqlite3')
  {
    const unsupported = newRoot(), otherPort = await freePort()
    fs.mkdirSync(join(unsupported, 'data-mcp'))
    const db = new Database(join(unsupported, 'data-mcp/teamsight.sqlite')); db.pragma('user_version = 5'); db.close()
    assert.match((await installer(unsupported, otherPort, ['--variant', 'external', '--node', externalNode], {}, false)).text, /DATA_SCHEMA_UNSUPPORTED/)
    assert.ok(!fs.existsSync(join(unsupported, 'installer-state.json')))
    assert.ok(!fs.existsSync(join(unsupported, '.installer-lock')))
    record('unsupported SQLite version rejected before service or config changes')
  }
  const database = new Database(db)
  database.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run('busy-fixture', 'running', JSON.stringify({ jobId: 'busy-fixture', status: 'running' }))
  assert.match((await installer(dir, port, [], {}, false)).text, /SERVICE_BUSY/)
  database.prepare('DELETE FROM jobs WHERE id=?').run('busy-fixture'); database.close()
  await installer(dir, port)
  assert.deepEqual(fs.readFileSync(join(p.data, 'access-token')), token)
  record('busy service refusal and idempotent reinstall preserve local token')
  const configHash = digest(fs.readFileSync(p.config)), startHash = digest(fs.readFileSync(p.start))
  for (const stage of ['after-start', 'after-config']) {
    assert.match((await installer(dir, port, ['--variant', 'external', '--node', externalNode], { TEAMSIGHT_INSTALL_TEST_FAIL: stage }, false)).text, /TEST_(START|CONFIG)_FAILURE/)
    assert.equal(digest(fs.readFileSync(p.config)), configHash)
    assert.equal(digest(fs.readFileSync(p.start)), startHash)
    assert.equal(JSON.parse(fs.readFileSync(p.state)).variant, 'bundled')
    assert.ok(!fs.existsSync(join(dir, 'versions/0.3.4-external')))
    await installer(dir, port, ['--status'])
    record('failed edition switch rollback ' + stage)
  }
  await installer(dir, port, ['--variant', 'external', '--node', externalNode])
  state = JSON.parse(fs.readFileSync(p.state))
  assert.equal(state.node, fs.realpathSync(externalNode))
  assert.deepEqual(fs.readFileSync(join(p.data, 'access-token')), token)
  await installer(dir, port, ['--status'])
  record('external fixed absolute Node and shared data compatibility')
  const out = spawnSync('/bin/launchctl', ['bootout', p.domain + '/' + p.label], { encoding: 'utf8' })
  assert.equal(out.status, 0)
  await new Promise(ok => setTimeout(ok, 1500))
  assert.equal(spawnSync('/bin/launchctl', ['bootstrap', p.domain, p.plist]).status, 0)
  await new Promise(ok => setTimeout(ok, 1500))
  await installer(dir, port, ['--status'])
  record('LaunchAgent unload/reload uses persisted absolute paths')
  assert.match((await installer(dir, port, ['--uninstall'], { TEAMSIGHT_INSTALL_TEST_FAIL: 'uninstall' }, false)).text, /TEST_UNINSTALL_FAILURE/)
  await installer(dir, port, ['--status'])
  record('uninstall failure restores packages, config and running service')
  await installer(dir, port, ['--uninstall'])
  assert.ok(!fs.existsSync(p.state)); assert.ok(!fs.existsSync(p.plist)); assert.ok(!fs.existsSync(p.start))
  assert.deepEqual(fs.readFileSync(join(p.data, 'access-token')), token)
  connection = parseConfig(fs.readFileSync(p.config, 'utf8'))
  assert.equal(connection.mcp_servers.teamsight, undefined)
  assert.equal(connection.mcp_servers.other.url, 'https://example.test')
  assert.ok(fs.existsSync(db))
  record('uninstall preserves database, token and other MCP settings')
  {
    const fresh = newRoot(), otherPort = await freePort(), fp = paths(fresh, join(fresh, 'codex'), true, otherPort)
    assert.match((await installer(fresh, otherPort, ['--variant', 'external', '--node', externalNode], { TEAMSIGHT_INSTALL_TEST_FAIL: 'after-config' }, false)).text, /TEST_CONFIG_FAILURE/)
    assert.ok(!fs.existsSync(fp.state)); assert.ok(!fs.existsSync(fp.config)); assert.ok(!fs.existsSync(fp.plist)); assert.ok(!fs.existsSync(fp.start))
    assert.ok(!fs.existsSync(join(fp.data, 'instance.lock')))
    assert.ok(!fs.existsSync(join(fresh, 'versions/0.3.4-external')))
    record('fresh installation failure restores absent config and cleans managed files')
  }
  {
    const conflictRoot = newRoot(), conflictPort = await freePort(), server = tcpServer()
    await new Promise(ok => server.listen(conflictPort, '127.0.0.1', ok))
    try { assert.match((await installer(conflictRoot, conflictPort, ['--variant', 'external', '--node', externalNode], {}, false)).text, /PORT_IN_USE/) }
    finally { await new Promise(ok => server.close(ok)) }
    assert.ok(!fs.existsSync(join(conflictRoot, 'versions/0.3.4-external')))
    record('port conflict refuses and cleans this attempt')
  }
  {
    const locked = newRoot(), lp = paths(locked, join(locked, 'codex'), true, await freePort())
    fs.mkdirSync(lp.data); fs.writeFileSync(join(lp.data, 'instance.lock'), 'unknown')
    assert.match((await installer(locked, lp.port, ['--variant', 'external', '--node', externalNode], {}, false)).text, /UNMANAGED_SERVICE/)
    assert.equal(fs.readFileSync(join(lp.data, 'instance.lock'), 'utf8'), 'unknown')
    record('unknown instance lock preserved')
  }
  if (process.env.TEAMSIGHT_TEST_LEGACY_INSTALLER) {
    const legacy = resolve(process.env.TEAMSIGHT_TEST_LEGACY_INSTALLER)
    const upgradeRoot = newRoot(), upgradePort = await freePort(), up = paths(upgradeRoot, join(upgradeRoot, 'codex'), true, upgradePort)
    await installer(upgradeRoot, upgradePort, [], {}, true, legacy)
    assert.equal(JSON.parse(fs.readFileSync(up.state)).version, '0.3.3')
    // The new manager must understand old state/health before starting an upgrade.
    await installer(upgradeRoot, upgradePort, ['--status'])
    const oldState = JSON.parse(fs.readFileSync(up.state))
    const legacyRequire = createRequire(join(oldState.packageDir, 'package.json')), LegacyDB = legacyRequire('better-sqlite3')
    const legacyDB = new LegacyDB(join(up.data, 'teamsight.sqlite'))
    const oldRow = legacyDB.prepare('SELECT revision,value FROM settings WHERE id=1').get(), preferences = JSON.parse(oldRow.value)
    preferences.tapd.defaultTypes = ['task'];preferences.tapd.writeAccess = { operations: [], fields: ['name', 'custom_field'] };preferences.chinaCalendar.enabled = false
    legacyDB.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(preferences));legacyDB.close()
    const savedState = fs.readFileSync(up.state), savedStart = fs.readFileSync(up.start), savedConfig = fs.readFileSync(up.config), savedToken = fs.readFileSync(join(up.data, 'access-token'))
    for (const stage of ['after-start', 'after-config']) {
      assert.match((await installer(upgradeRoot, upgradePort, [], { TEAMSIGHT_INSTALL_TEST_FAIL: stage }, false)).text, /TEST_(START|CONFIG)_FAILURE/)
      assert.deepEqual(fs.readFileSync(up.state), savedState);assert.deepEqual(fs.readFileSync(up.start), savedStart);assert.deepEqual(fs.readFileSync(up.config), savedConfig)
      assert.ok(!fs.existsSync(join(upgradeRoot, 'versions/0.3.4-bundled')))
      await installer(upgradeRoot, upgradePort, ['--status'])
      record('0.3.3 upgrade rollback restores legacy instance ' + stage)
    }
    await installer(upgradeRoot, upgradePort)
    const upgraded = JSON.parse(fs.readFileSync(up.state))
    assert.equal(upgraded.version, '0.3.4');assert.deepEqual(upgraded.ownedPackages.sort(), ['0.3.3-bundled', '0.3.4-bundled'])
    const reopened = new LegacyDB(join(up.data, 'teamsight.sqlite'), { readonly: true })
    const currentRow = reopened.prepare('SELECT revision,value FROM settings WHERE id=1').get();reopened.close()
    assert.equal(currentRow.revision, oldRow.revision);assert.deepEqual(JSON.parse(currentRow.value), preferences)
    assert.deepEqual(fs.readFileSync(join(up.data, 'access-token')), savedToken)
    await installer(upgradeRoot, upgradePort, ['--status'])
    await installer(upgradeRoot, upgradePort, ['--uninstall'])
    assert.ok(!fs.existsSync(join(upgradeRoot, 'versions/0.3.3-bundled')));assert.ok(!fs.existsSync(join(upgradeRoot, 'versions/0.3.4-bundled')))
    record('0.3.3 to 0.3.4 upgrade preserves opt-outs/custom fields/revision/token and supports uninstall')
  }
  if (agentSite) {
    const oldBuild = spawnSync(process.execPath, [join(root, 'scripts/build-installer.mjs'), '--pages', join(root, 'artifacts/releases/0.3.4'), previousSite, '0.3.4'], { encoding: 'utf8' })
    assert.equal(oldBuild.status, 0, oldBuild.stderr)
    const externalEnv = { PATH: dirname(externalNode) + ':/usr/bin:/bin' }
    for (const [mode, error] of [['script-truncated', /end of file|here-document/], ['corrupt', /ARCHIVE_HASH_MISMATCH/], ['interrupted', /DOWNLOAD_FAILED/]]) {
      const faulty = newRoot(), faultyPort = await freePort(), before = packageRequests
      responseMode = mode
      await agentInstall(faulty, faultyPort, { error })
      assert.ok(!fs.existsSync(join(faulty, 'installer-state.json')))
      if (mode === 'script-truncated') assert.equal(packageRequests, before)
      record('Pages pipe rejects ' + mode + ' without a success result')
    }
    responseMode = 'normal'
    const agentRoot = newRoot(), agentPort = await freePort(), customHome = join(agentRoot, 'codex custom')
    const agentPaths = paths(agentRoot, customHome, true, agentPort)
    fs.mkdirSync(customHome)
    const untouched = '# untouched\n[mcp_servers.other]\nurl="https://example.test"\n'
    fs.writeFileSync(agentPaths.config, untouched)
    const installed = await agentInstall(agentRoot, agentPort, { extraEnv: { CODEX_HOME: customHome } })
    assert.equal(installed.action, 'installed'); assert.equal(installed.version, '0.3.5'); assert.equal(installed.variant, 'bundled')
    assert.equal(fs.readFileSync(agentPaths.config, 'utf8'), untouched)
    assert.ok(!fs.existsSync(join(agentRoot, 'codex')))
    const token = fs.readFileSync(installed.credentialFile, 'utf8')
    const foreign = untouched + '[mcp_servers.teamsight]\nurl="https://unrelated.example"\n'
    fs.writeFileSync(agentPaths.config, foreign)
    const helperEnv = { ...process.env, CODEX_HOME: customHome }
    const conflict = spawnSync(installed.codexHelper, [], { env: helperEnv, encoding: 'utf8' })
    assert.notEqual(conflict.status, 0); assert.match(conflict.stderr, /CODEX_CONNECTION_CONFLICT/)
    assert.equal(fs.readFileSync(agentPaths.config, 'utf8'), foreign)
    fs.writeFileSync(agentPaths.config, untouched)
    const configured = spawnSync(installed.codexHelper, [], { env: helperEnv, encoding: 'utf8' })
    assert.equal(configured.status, 0, configured.stderr); assert.ok(!(configured.stdout + configured.stderr).includes(token))
    assert.equal(JSON.parse(configured.stdout).instanceId, installed.instanceId)
    const configuredBytes = fs.readFileSync(agentPaths.config, 'utf8'), entries = parseConfig(configuredBytes).mcp_servers
    assert.equal(entries.teamsight.http_headers.Authorization, 'Bearer ' + token)
    assert.equal(entries.other.url, 'https://example.test'); assert.equal(fs.statSync(agentPaths.config).mode & 0o777, 0o600)
    const noChange = spawnSync(installed.codexHelper, [], { env: helperEnv, encoding: 'utf8' })
    assert.equal(noChange.status, 0, noChange.stderr); assert.equal(JSON.parse(noChange.stdout).codex, 'unchanged')
    if (process.env.TEAMSIGHT_TEST_CODEX) {
      await verifyCodexConnection(process.env.TEAMSIGHT_TEST_CODEX, installed, agentRoot)
      record('Isolated Codex app-server invokes teamsight_status and matches the installed instance')
    }
    const requestsAfterInstall = packageRequests
    assert.equal((await agentInstall(agentRoot, agentPort)).action, 'already-current')
    assert.equal((await agentInstall(agentRoot, agentPort, { older: true })).action, 'newer-local')
    assert.equal(packageRequests, requestsAfterInstall)
    record('Pages bundled: no Node in PATH; separate Codex helper safely aborts conflict and is idempotent; skip repeats and downgrades without downloads')
    const freshExternal = newRoot(), externalPort = await freePort()
    await agentInstall(freshExternal, externalPort, { variant: 'external', error: /NODE_MISSING/ })
    const incompatible = join(freshExternal, 'node'); fs.writeFileSync(incompatible, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    await agentInstall(freshExternal, externalPort, { variant: 'external', extraEnv: { PATH: freshExternal + ':/usr/bin:/bin' }, error: /NODE_UNSUPPORTED/ })
    const external = await agentInstall(freshExternal, externalPort, { variant: 'external', extraEnv: externalEnv })
    assert.equal(external.action, 'installed')
    if (process.env.TEAMSIGHT_TEST_CODEX) {
      await verifyCodexConnection(process.env.TEAMSIGHT_TEST_CODEX, external, freshExternal)
      record('Isolated Codex app-server also invokes teamsight_status on the external install')
    }
    assert.equal((await agentInstall(agentRoot, agentPort, { variant: 'external', extraEnv: externalEnv })).action, 'variant-switched')
    assert.equal(fs.readFileSync(agentPaths.config, 'utf8'), configuredBytes)
    assert.equal(fs.readFileSync(installed.credentialFile, 'utf8'), token)
    record('Pages external: diagnoses incompatible Node, fresh install and same-version switch preserve the managed connection')
    const occupied = tcpServer(), conflictRoot = newRoot()
    await new Promise(ok => occupied.listen(0, '127.0.0.1', ok))
    try { await agentInstall(conflictRoot, occupied.address().port, { error: /PORT_IN_USE/ }) }
    finally { await new Promise(ok => occupied.close(ok)) }
    record('Pages does not take over an occupied local port')
    const upgradeRoot = newRoot(), upgradePort = await freePort(), upgrade = paths(upgradeRoot, join(upgradeRoot, 'codex'), true, upgradePort)
    await installer(upgradeRoot, upgradePort)
    const originalState = fs.readFileSync(upgrade.state), originalConfig = fs.readFileSync(upgrade.config), originalToken = fs.readFileSync(join(upgrade.data, 'access-token'))
    const oldPackage = JSON.parse(originalState).packageDir
    const UpgradeDB = createRequire(join(oldPackage, 'package.json'))('better-sqlite3')
    const upgradeDbPath = join(upgrade.data, 'teamsight.sqlite'), upgradeDb = new UpgradeDB(upgradeDbPath)
    const settings = JSON.parse(upgradeDb.prepare('SELECT value FROM settings WHERE id=1').get().value)
    settings.teamName = '保留的受管设置'; settings.chinaCalendar.enabled = false
    upgradeDb.prepare('UPDATE settings SET value=?, revision=? WHERE id=1').run(JSON.stringify(settings), 4); upgradeDb.close()
    await agentInstall(upgradeRoot, upgradePort, { extraEnv: { TEAMSIGHT_INSTALL_TEST_FAIL: 'after-start' }, error: /TEST_START_FAILURE/ })
    assert.deepEqual(fs.readFileSync(upgrade.state), originalState); assert.deepEqual(fs.readFileSync(upgrade.config), originalConfig)
    assert.ok(!fs.existsSync(upgrade.helper)); await installer(upgradeRoot, upgradePort, ['--status'])
    assert.equal((await agentInstall(upgradeRoot, upgradePort)).action, 'upgraded')
    assert.deepEqual(fs.readFileSync(upgrade.config), originalConfig); assert.deepEqual(fs.readFileSync(join(upgrade.data, 'access-token')), originalToken)
    const upgradedDb = new UpgradeDB(upgradeDbPath, { readonly: true })
    const row = upgradedDb.prepare('SELECT revision,value FROM settings WHERE id=1').get(); upgradedDb.close()
    assert.equal(row.revision, 4); assert.deepEqual(JSON.parse(row.value), settings)
    record('Pages 0.3.4 legacy upgrade rolls back after start, and then preserves the original Codex config and connection key')
  }
  fs.writeFileSync(join(evidence, 'acceptance.json'), JSON.stringify({ ok: true, node: process.versions.node, records, publicDownload: 'pending-repository-publication', receivingCodex: 'pending-separate-machine-validation' }, null, 2))
} finally {
  for (const dir of roots) {
    const p = paths(dir, join(dir, 'codex'), true)
    spawnSync('/bin/launchctl', ['bootout', p.domain + '/' + p.label], { stdio: 'ignore' })
  }
  for (const socket of sockets) socket.destroy()
  await new Promise(ok => fixture.close(ok))
  // Short grace for launchd SIGTERM; production service is never touched.
  await new Promise(ok => setTimeout(ok, 1000))
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(testBase, { recursive: true, force: true })
}
