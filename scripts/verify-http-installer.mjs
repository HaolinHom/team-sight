// Real HTTPS/native/launchd acceptance. Only isolated roots and test labels are used.
import * as fs from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { digest, paths } from './installer/main.mjs'
import { parseConfig } from './installer/config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = resolve(process.argv[2] ?? '.local/validation/http-installer/acceptance')
fs.mkdirSync(evidence, { recursive: true })
const testBase = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'teamsight-installer-test-')))
const ca = join(testBase, 'ca.pem'), key = join(testBase, 'key.pem'), config = join(testBase, 'openssl.cnf')
fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n')
assert.equal(spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', ca, '-days', '1', '-config', config], { stdio: 'ignore' }).status, 0)
let responseMode = 'normal'
const sockets = new Set(), records = [], roots = new Set()
const fixture = createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(ca) }, (req, res) => {
  if (responseMode === '404') { res.writeHead(404); res.end(); return }
  if (responseMode === 'timeout') return
  if (responseMode === 'corrupt') { res.end('corrupt'); return }
  const name = req.url.slice(1)
  if (!/^teamsight-mcp-0\.3\.3-darwin-arm64-(bundled|external)\.tar\.gz$/.test(name)) { res.writeHead(404); res.end(); return }
  const path = join(root, 'artifacts/releases/0.3.3', name)
  res.writeHead(200, { 'content-length': fs.statSync(path).size })
  if (responseMode === 'interrupted') { res.write('partial'); res.destroy(); return }
  fs.createReadStream(path).pipe(res)
})
fixture.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise(ok => fixture.listen(0, '127.0.0.1', ok))
const baseUrl = 'https://127.0.0.1:' + fixture.address().port
const externalNode = join(root, 'artifacts/releases/0.3.3/teamsight-mcp-darwin-arm64-bundled/runtime/node')
function newRoot() {
  const original = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'teamsight-installer-test-'))), path = original + ' with spaces'
  fs.renameSync(original, path); roots.add(path); return path
}
async function freePort() {
  const server = tcpServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port
}
async function installer(testRoot, port, args = [], extraEnv = {}, success = true) {
  const output = await new Promise(ok => {
    const child = spawn('/bin/bash', [join(root, 'scripts/install.sh'), '--test-root', testRoot, '--test-base-url', baseUrl, '--test-ca', ca, '--test-port', String(port), ...args],
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
function record(name, result = 'passed') { records.push({ name, result }); console.log('PASS ' + name) }
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
  assert.equal(spawnSync('/usr/bin/xattr', ['-r', join(dir, 'versions/0.3.3-bundled')], { encoding: 'utf8' }).stdout.includes('com.apple.quarantine'), false)
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
    assert.ok(!fs.existsSync(join(dir, 'versions/0.3.3-external')))
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
    assert.ok(!fs.existsSync(join(fresh, 'versions/0.3.3-external')))
    record('fresh installation failure restores absent config and cleans managed files')
  }
  {
    const conflictRoot = newRoot(), conflictPort = await freePort(), server = tcpServer()
    await new Promise(ok => server.listen(conflictPort, '127.0.0.1', ok))
    try { assert.match((await installer(conflictRoot, conflictPort, ['--variant', 'external', '--node', externalNode], {}, false)).text, /PORT_IN_USE/) }
    finally { await new Promise(ok => server.close(ok)) }
    assert.ok(!fs.existsSync(join(conflictRoot, 'versions/0.3.3-external')))
    record('port conflict refuses and cleans this attempt')
  }
  {
    const locked = newRoot(), lp = paths(locked, join(locked, 'codex'), true, await freePort())
    fs.mkdirSync(lp.data); fs.writeFileSync(join(lp.data, 'instance.lock'), 'unknown')
    assert.match((await installer(locked, lp.port, ['--variant', 'external', '--node', externalNode], {}, false)).text, /UNMANAGED_SERVICE/)
    assert.equal(fs.readFileSync(join(lp.data, 'instance.lock'), 'utf8'), 'unknown')
    record('unknown instance lock preserved')
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
