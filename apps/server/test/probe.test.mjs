import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { openStore } from '../dist/storage.js'
import { runtimeProblem } from '../dist/runtime.js'
import { startServer, UI_URI } from '../dist/server.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

test('runtime guard rejects incompatible Node and Node-API', () => {
  assert.equal(runtimeProblem('22.23.4', '10'), null)
  for (const pair of [['20.19.0', '9'], ['22.13.0', '10'], ['24.0.0', '10'], ['22.23.4', '9']]) assert.match(runtimeProblem(...pair), /NODE_UNSUPPORTED/)
})

test('SQLite CAS, actual database write failure, rollback and restart persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p0-db-'))
  const vault = { put() {}, get() { return null }, remove() {} }
  let store = openStore(dir, vault)
  try {
    const first = store.save({ expectedRevision: 0, patch: { teamName: '修订一' } })
    assert.equal(first.revision, 1)
    assert.throws(() => store.save({ expectedRevision: 0, patch: { teamName: '冲突' } }), /REVISION_CONFLICT/)
    assert.throws(() => store.save({ expectedRevision: 1, patch: { teamName: '应回滚' }, simulateFailure: true }), /SAVE_FAILED/)
    assert.deepEqual(store.read(), first)
    store.db.pragma('query_only = ON')
    assert.throws(() => store.save({ expectedRevision: 1, patch: { teamName: '只读失败' } }), /STORAGE_WRITE_FAILED/)
    assert.deepEqual(store.read(), first)
    store.close(); store = openStore(dir, vault)
    assert.deepEqual(store.read(), first)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('SQLite lock wait is bounded and does not commit a failed write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p0-lock-'))
  const store = openStore(dir)
  const rival = openStore(dir)
  try {
    rival.db.exec('BEGIN IMMEDIATE')
    const started = performance.now()
    assert.throws(() => store.save({ expectedRevision: 0, patch: { teamName: 'blocked' } }), /STORAGE_WRITE_FAILED/)
    const waited = performance.now() - started
    console.log(JSON.stringify({ sqliteLockWaitMs: Math.round(waited), configuredBusyTimeoutMs: 1000, synchronousWaitBlocksEventLoop: true }))
    assert.ok(waited >= 800 && waited < 5000)
    rival.db.exec('ROLLBACK')
    assert.equal(store.read().revision, 0)
  } finally { rival.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP two clients share process, auth guards, resources, CAS, restart and shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p0-http-'))
  const occupiedDir = mkdtempSync(join(tmpdir(), 'teamsight-p0-occupied-'))
  let service = await startServer({ dataDir: dir, port: 0 })
  const connections = []
  async function connect() {
    const client = new Client({ name: 'p0-test', version: '1' })
    const token = readFileSync(join(dir, 'access-token'), 'utf8').trim()
    const transport = new StreamableHTTPClientTransport(new URL(service.info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
    await client.connect(transport)
    connections.push({ client, transport })
    return client
  }
  const call = (c, name, args = {}) => c.callTool({ name, arguments: args })
  try {
    await assert.rejects(startServer({ dataDir: dir, port: 0 }), /INSTANCE_LOCKED/)
    await assert.rejects(startServer({ dataDir: occupiedDir, port: Number(new URL(service.info.url).port) }), /PORT_IN_USE/)
    const token = readFileSync(join(dir, 'access-token'), 'utf8').trim()
    assert.equal((await fetch(service.info.url)).status, 401)
    const badHost = await new Promise((ok, fail) => {
      const req = request(service.info.url, { headers: { Authorization: `Bearer ${token}`, Host: 'evil.test' } }, res => { res.resume(); ok(res.statusCode) })
      req.on('error', fail); req.end()
    })
    assert.equal(badHost, 403)
    for (const origin of ['null', 'https://evil.test', 'http://127.0.0.1:9999']) assert.equal((await fetch(service.info.url, { headers: { Authorization: `Bearer ${token}`, Origin: origin } })).status, 403)
    const [a, b] = await Promise.all([connect(), connect()])
    const [sa, sb] = await Promise.all([call(a, 'teamsight_status'), call(b, 'teamsight_status')])
    assert.equal(sa.structuredContent.instanceId, sb.structuredContent.instanceId)
    assert.equal(sa.structuredContent.pid, process.pid)
    const listed = await a.listTools()
    assert.ok(listed.tools.some(t => t.name === 'teamsight_probe_open_settings' && t._meta.ui.resourceUri === UI_URI))
    assert.ok((await a.listResources()).resources.some(r => r.uri === UI_URI))
    const resource = await a.readResource({ uri: UI_URI })
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app')
    assert.doesNotMatch(resource.contents[0].text, /<script[^>]*\bsrc=/)
    const saved = await call(a, 'teamsight_probe_save_config', { expectedRevision: 0, patch: { teamName: '并发会话' } })
    assert.equal(saved.structuredContent.revision, 1)
    const conflict = await call(b, 'teamsight_probe_save_config', { expectedRevision: 0, patch: { teamName: '不应覆盖' } })
    assert.equal(conflict.isError, true)
    assert.equal(conflict.structuredContent.code, 'REVISION_CONFLICT')
    const failed = await call(a, 'teamsight_probe_save_config', { expectedRevision: 1, patch: { teamName: '不应保存' }, simulateFailure: true })
    assert.equal(failed.structuredContent.code, 'SAVE_FAILED')
    assert.equal((await call(b, 'teamsight_probe_read_config')).structuredContent.config.teamName, '并发会话')
    const png = await call(a, 'teamsight_probe_render')
    assert.equal(Buffer.from(png.content[0].data, 'base64').readUInt32BE(16), 720)
    for (const c of connections.splice(0)) { await c.transport.terminateSession(); await c.client.close() }
    await service.close()
    service = await startServer({ dataDir: dir, port: 0 })
    const c = await connect()
    assert.equal((await call(c, 'teamsight_probe_read_config')).structuredContent.revision, 1)
    assert.equal((await call(c, 'teamsight_probe_read_config')).structuredContent.config.teamName, '并发会话')
  } finally {
    for (const c of connections) { await c.transport.terminateSession().catch(() => {}); await c.client.close() }
    await service.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(occupiedDir, { recursive: true, force: true })
  }
})
