import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { openStore } from '../dist/storage.js'
import { runtimeProblem } from '../dist/runtime.js'
import { startServer, UI_URI, SETTINGS_UI_URI } from '../dist/server.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { TapdError } from '@teamsight/tapd'

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

test('P1a settings migration, credential reference and cache survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p1a-db-'))
  const secrets = new Map()
  const vault = {
    put(account, value) { secrets.set(account, value) },
    get(account) { return secrets.get(account) ?? null },
    remove(account) { secrets.delete(account) },
  }
  let store = openStore(dir, vault)
  try {
    const imported = store.importSettings({ expectedRevision: 0, raw: { teamName: '旧团队', tapdToken: 'IGNORE_ME', hours: { dailyRequiredHours: 7.5 } }, source: 'legacy.json' })
    assert.equal(imported.revision, 1)
    assert.equal(imported.ignoredCredential, true)
    const saved = store.saveSettings({ expectedRevision: 1, patch: { teamName: '新团队' }, credential: 'SECRET' })
    assert.equal(saved.revision, 2)
    assert.equal(saved.credentialPresent, true)
    store.putCache('cache-key', '2026-10-28T00:00:00.000Z', 'complete', { tasks: [{ id: '1' }] })
    store.close()
    store = openStore(dir, vault)
    const restored = store.readSettings()
    assert.equal(restored.revision, 2)
    assert.equal(restored.settings.teamName, '新团队')
    assert.equal(restored.credentialPresent, true)
    assert.deepEqual(store.read().config, { teamName: '新团队', dailyHours: 7.5, timeZone: 'Asia/Shanghai' })
    assert.deepEqual(store.getCache('cache-key')?.value, { tasks: [{ id: '1' }] })
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
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

test('P1a settings import, credential isolation, TAPD read-only queries and schedule cache states', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p1a-http-'))
  const secrets = new Map()
  const vault = {
    put(account, value) { secrets.set(account, value) },
    get(account) { return secrets.get(account) ?? null },
    remove(account) { secrets.delete(account) },
  }
  const calls = []
  let mode = 'complete'
  const tapdTransport = async (path, params) => {
    calls.push({ path, params })
    if (!secrets.size) throw new TapdError('TAPD 凭据未配置', 401)
    if (mode === 'failed' || (mode === 'partial' && path === '/bugs')) return { status: 403, info: 'project denied', data: [] }
    if (path === '/workspaces/user_participant_projects') return { status: 1, info: 'success', data: [{ Workspace: { id: 'p1', name: '项目一', status: 'normal' } }] }
    if (path === '/tasks') return { status: 1, info: 'success', data: [{ Task: { id: 't1', name: '联调任务', owner: '张三_100', begin: '2026-10-01', due: '2026-10-03', status: 'open', effort: '8', workspace_id: 'p1' } }] }
    if (path === '/bugs') return { status: 1, info: 'success', data: [{ Bug: { id: 'b1', title: '缺陷', current_owner: '李四_200', begin: '2026-10-02', due: '2026-10-04', status: 'open', workspace_id: 'p1' } }] }
    if (path === '/tasks/t1') return { status: 1, info: 'success', data: { Task: { id: 't1', name: '联调任务', owner: '张三_100', status: 'open', workspace_id: 'p1' } } }
    throw new Error(`unexpected TAPD path ${path}`)
  }
  let service
  const clients = []
  const call = (client, name, args = {}) => client.callTool({ name, arguments: args })
  try {
    service = await startServer({ dataDir: dir, port: 0, vault, tapdTransport })
    const token = readFileSync(join(dir, 'access-token'), 'utf8').trim()
    const client = new Client({ name: 'p1a-test', version: '1' })
    const transport = new StreamableHTTPClientTransport(new URL(service.info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
    await client.connect(transport)
    clients.push({ client, transport })

    const listed = await client.listTools()
    assert.ok(listed.tools.some(tool => tool.name === 'teamsight_open_settings' && tool._meta.ui.resourceUri === SETTINGS_UI_URI))
    const resources = await client.listResources()
    assert.ok(resources.resources.some(resource => resource.uri === SETTINGS_UI_URI))
    const settingsResource = await client.readResource({ uri: SETTINGS_UI_URI })
    assert.equal(settingsResource.contents[0].mimeType, 'text/html;profile=mcp-app')
    assert.match(settingsResource.contents[0].text, /TeamSight 设置/)
    assert.doesNotMatch(settingsResource.contents[0].text, /<script[^>]*\bsrc=/)
    const missingCredential = await call(client, 'tapd_list_projects')
    assert.equal(missingCredential.structuredContent.code, 'CONFIG_REQUIRED')

    const imported = await call(client, 'teamsight_import_settings', {
      expectedRevision: 0,
      settingsJson: JSON.stringify({ teamName: '前端组', timeZone: 'UTC', projects: [{ id: 'p1', name: '项目一', enabled: true, color: '#3b82f6' }], members: [{ staffId: '100', name: '张三' }], tapd: { baseUrl: 'https://api.tapd.cn', workspaceIds: ['p1'] }, tapdToken: 'DO_NOT_STORE' }),
      source: 'legacy-test.json',
    })
    assert.equal(imported.structuredContent.settings.teamName, '前端组')
    assert.equal(imported.structuredContent.settings.timeZone, 'UTC')
    assert.equal(imported.structuredContent.ignoredCredential, true)
    assert.equal(imported.structuredContent.credentialPresent, false)
    assert.doesNotMatch(JSON.stringify(imported.structuredContent), /DO_NOT_STORE/)

    const saved = await call(client, 'teamsight_save_settings', { expectedRevision: 1, patch: { members: [{ staffId: '100', name: '张三' }, { staffId: '200', name: '李四' }] }, tapdToken: 'MOCK_TOKEN' })
    assert.equal(saved.structuredContent.revision, 3)
    assert.equal(saved.structuredContent.credentialPresent, true)
    assert.doesNotMatch(JSON.stringify(saved.structuredContent), /MOCK_TOKEN/)
    assert.equal(secrets.size, 1)
    const mirrored = await call(client, 'teamsight_probe_read_config')
    assert.deepEqual(mirrored.structuredContent.config, { teamName: '前端组', dailyHours: 8, timeZone: 'UTC' })
    assert.equal(mirrored.structuredContent.revision, 3)
    const conflict = await call(client, 'teamsight_save_settings', { expectedRevision: 1, patch: { teamName: '不应覆盖' } })
    assert.equal(conflict.isError, true)
    assert.equal(conflict.structuredContent.code, 'REVISION_CONFLICT')

    const projects = await call(client, 'tapd_list_projects')
    assert.equal(projects.structuredContent.projects[0].id, 'p1')
    const search = await call(client, 'tapd_search_items', { workspaceId: 'p1', entityType: 'task', keyword: '联调' })
    assert.equal(search.structuredContent.tasks[0].assigneeName, '张三')
    assert.equal(search.structuredContent.tasks[0].tapdUrl, 'https://www.tapd.cn/tapd_fe/p1/task/detail/t1')
    const item = await call(client, 'tapd_get_item', { workspaceId: 'p1', entityType: 'task', id: 't1' })
    assert.equal(item.structuredContent.item.id, 't1')

    calls.length = 0
    mode = 'complete'
    const complete = await call(client, 'teamsight_get_schedule', { start: '2026-10-01', end: '2026-10-31' })
    assert.equal(complete.structuredContent.status, 'complete')
    assert.equal(complete.structuredContent.tasks.length, 2)
    const firstFetchCount = calls.length
    const cached = await call(client, 'teamsight_get_schedule', { start: '2026-10-01', end: '2026-10-31' })
    assert.equal(cached.structuredContent.cacheHit, true)
    assert.equal(calls.length, firstFetchCount)

    mode = 'partial'
    const partial = await call(client, 'teamsight_get_schedule', { start: '2026-11-01', end: '2026-11-30', refresh: true })
    assert.equal(partial.structuredContent.status, 'partial')
    assert.equal(partial.structuredContent.errors.length, 1)
    mode = 'failed'
    const failed = await call(client, 'teamsight_get_schedule', { start: '2026-12-01', end: '2026-12-31', refresh: true })
    assert.equal(failed.structuredContent.status, 'failed')
    assert.equal(failed.structuredContent.tasks.length, 0)
  } finally {
    for (const entry of clients) { await entry.transport.terminateSession().catch(() => {}); await entry.client.close().catch(() => {}) }
    await service?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
