import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../dist/storage.js'
import { createBusiness } from '../dist/business.js'
import { businessStorage, fieldHashes } from '../dist/business-storage.js'
import { generateReport, renderGantt, ganttSvgs, csvCell } from '../dist/outputs.js'
import { startServer } from '../dist/server.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { TapdError } from '@teamsight/tapd'
import { ANALYSIS_UI_URI } from '../dist/business-tools.js'

const project = { id: '62119705', name: '测试项目', enabled: true, color: '#167d7f' }
const fields = ['name', 'description', 'owner', 'begin', 'due', 'effort', 'status', 'story_id']
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-p1b-')), secrets = new Map(), rows = new Map(), calls = []
  const vault = { put: (id, value) => secrets.set(id, value), get: id => secrets.get(id) ?? null, remove: id => secrets.delete(id) }
  let mode = 'ok', writeCount = 0
  const response = data => ({ status: 1, info: 'success', data, httpStatus: 200 })
  const task = { id: '101621197051000000001', workspace_id: project.id, name: '测试任务', owner: '张三_100', begin: '2026-10-28', due: '2026-11-02', effort: '24', status: 'open', modified: '2026-10-28 10:00:00' }
  rows.set('task:' + task.id, task)
  const transport = async (path, params, signal, request) => {
    calls.push({ path, params: { ...params }, method: request?.method ?? 'GET' })
    signal?.throwIfAborted()
    if (mode === 'slow') await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1000); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true }) })
    if (request?.method === 'POST') {
      writeCount++
      if (mode === 'timeout') throw new Error('network lost after emission')
      if (mode === 'reject') throw new TapdError('forbidden', 403, 403, 0)
      const type = path === '/stories' ? 'story' : 'task', key = type === 'story' ? 'Story' : 'Task'
      const id = params.id ?? '101621197051999999999'
      const row = { ...(rows.get(type + ':' + id) ?? { id, status: 'open' }), ...params, ...(params.owner ? { owner: params.owner + ';' } : {}), modified: String(writeCount) }
      rows.set(type + ':' + id, row)
      return response({ [key]: row })
    }
    if (path === '/workspaces/users') {
      if (mode === 'directory-failed') throw new TapdError('denied', 403)
      return response([{ UserWorkspace: { user: '张三_100' } }, { UserWorkspace: { user: '李四_200' } }])
    }
    if (path === '/tasks/custom_fields_settings') return response([])
    if (path === '/stories/get_fields_info') return response({ name: { readonly: 0 }, status: { options: { planning: '规划中', developing: '实现中' } } })
    if (path === '/workspaces/user_participant_projects') return response([{ Workspace: project }])
    if (path === '/tasks' || path === '/stories' || path === '/bugs') {
      if (mode === 'all-failed') throw new TapdError('denied', 403)
      const type = path === '/tasks' ? 'task' : path === '/stories' ? 'story' : 'bug', key = { task: 'Task', story: 'Story', bug: 'Bug' }[type]
      if (params.id) {
        if (mode === 'readback-missing') return response([])
        const row = rows.get(type + ':' + params.id)
        return response(row ? [{ [key]: row }] : [])
      }
      return response([...rows.entries()].filter(([entry, row]) => entry.startsWith(type + ':') && (!params.owner || row.owner === params.owner)).map(([, row]) => ({ [key]: row })))
    }
    if (path === '/timesheets') {
      if (mode === 'actual-failed' && !params.entity_id || mode === 'all-failed') throw new TapdError('denied', 403)
      const cumulative = Boolean(params.entity_id)
      return response([{ Timesheet: { id: cumulative ? 'r0' : 'r1', workspace_id: project.id, entity_type: 'task', entity_id: task.id, owner: '张三_100', spentdate: cumulative ? '2026-09-30' : '2026-10-27', timespent: cumulative ? '4' : '5', is_delete: '0' } }])
    }
    throw new Error('unexpected endpoint ' + path)
  }
  let store = openStore(dir, vault)
  store.saveSettings({ expectedRevision: 0, credential: 'ISOLATED_TEST_CREDENTIAL', patch: { projects: [project], members: [{ staffId: '200', name: '李四' }, { staffId: '100', name: '张三' }],
    tapd: { baseUrl: 'https://api.tapd.cn', workspaceIds: [project.id], defaultTypes: ['task', 'bug'], writeAccess: { workspaceIds: [project.id], operations: ['create', 'update'], fields } } } })
  let business = createBusiness(store, dir, transport)
  return { dir, vault, calls, rows, task, transport, get store() { return store }, get business() { return business }, setMode(value) { mode = value }, writes: () => writeCount,
    restart() { store.close(); store = openStore(dir, vault); business = createBusiness(store, dir, transport) },
    async close() { await business.close(); store.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const createInput = () => ({ workspaceId: project.id, entityType: 'task', fields: { name: 'TeamSight P1b 验收', owner: '张三_100', effort: '8' }, idempotencyKey: 'create-task-test', actor: 'test' })
const query = { start: '2026-10-27', end: '2026-11-02', analysisDate: '2026-10-28' }

test('writes share an idempotency receipt across concurrent clients and verify by read-back', async () => {
  const f = fixture()
  try {
    const [a, b] = await Promise.all([f.business.write(createInput(), 'create'), f.business.write(createInput(), 'create')])
    assert.equal(a.operationId, b.operationId); assert.equal(a.status, 'succeeded'); assert.equal(f.writes(), 1)
    assert.equal(f.calls.filter(call => call.method === 'POST')[0].path, '/tasks')
    await assert.rejects(f.business.write({ ...createInput(), fields: { name: 'different' } }, 'create'), /IDEMPOTENCY_KEY_CONFLICT/)
    f.restart()
    assert.equal((await f.business.write(createInput(), 'create')).replayed, true)
    assert.equal(f.writes(), 1)
    assert.doesNotMatch(JSON.stringify(f.business.files.getOperation(a.operationId)), /ISOLATED_TEST_CREDENTIAL|TeamSight P1b 验收/)
  } finally { await f.close() }
})

test('write scopes, identity candidates and stale field digest prevent any emitted mutation', async () => {
  const f = fixture()
  try {
    await assert.rejects(f.business.write({ ...createInput(), workspaceId: 'elsewhere' }, 'create'), /PROJECT_NOT_ALLOWED/)
    await assert.rejects(f.business.write({ ...createInput(), fields: { creator: 'x' } }, 'create'), /FIELD_NOT_ALLOWED/)
    const candidate = await f.business.write({ ...createInput(), idempotencyKey: 'ambiguous-owner', fields: { name: 'x', owner: '张三' } }, 'create')
    assert.equal(candidate.code, 'EXACT_IDENTITY_REQUIRED'); assert.equal(candidate.status, 'failed')
    const item = await f.business.readItem({ workspaceId: project.id, entityType: 'task', id: f.task.id })
    f.rows.set('task:' + f.task.id, { ...f.task, modified: 'someone else' })
    const conflict = await f.business.write({ ...createInput(), idempotencyKey: 'conflict-update', fields: { name: 'changed' }, id: f.task.id, expectedDigest: item.digest }, 'update')
    assert.equal(conflict.code, 'ITEM_CONFLICT'); assert.equal(f.writes(), 0)
    const current = await f.business.readItem({ workspaceId: project.id, entityType: 'task', id: f.task.id })
    const updated = await f.business.write({ ...createInput(), idempotencyKey: 'successful-update', fields: { name: 'changed' }, id: f.task.id, expectedDigest: current.digest }, 'update')
    assert.equal(updated.status, 'succeeded'); assert.equal(updated.remoteId, f.task.id)
  } finally { await f.close() }
})

test('an emitted timeout is unknown, survives restart and is never automatically reissued', async () => {
  const f = fixture()
  try {
    f.setMode('timeout')
    const first = await f.business.write(createInput(), 'create')
    assert.equal(first.status, 'unknown'); assert.equal(f.writes(), 1)
    f.restart(); f.setMode('ok')
    assert.equal((await f.business.write(createInput(), 'create')).status, 'unknown'); assert.equal(f.writes(), 1)
    const remoteId = '101621197051999999991'
    f.rows.set('task:' + remoteId, { id: remoteId, workspace_id: project.id, ...createInput().fields })
    assert.equal((await f.business.verifyOperation(first.operationId, remoteId)).status, 'succeeded')
    assert.equal(f.writes(), 1)
  } finally { await f.close() }
})

test('successful POST followed by missing read-back stays unknown, while explicit rejection fails', async () => {
  const f = fixture()
  try {
    f.setMode('readback-missing')
    const result = await f.business.write(createInput(), 'create')
    assert.equal(result.status, 'unknown'); assert.ok(result.remoteId)
    f.setMode('reject')
    const rejected = await f.business.write({ ...createInput(), idempotencyKey: 'reject-test-write' }, 'create')
    assert.equal(rejected.status, 'failed'); assert.equal(rejected.httpStatus, 403); assert.equal(rejected.businessStatus, 0)
  } finally { await f.close() }
})

test('analysis separates actual/cumulative reads, preserves source time/order and reuses facts for rule changes', async () => {
  const f = fixture()
  try {
    const analysis = await f.business.analyze(query)
    assert.equal(analysis.status, 'complete'); assert.deepEqual(analysis.context.memberIds, ['200', '100'])
    assert.ok(f.calls.some(call => call.path === '/timesheets' && !call.params.entity_id && call.params.spentdate === '2026-10-27~2026-10-28'))
    assert.ok(f.calls.some(call => call.path === '/timesheets' && call.params.entity_id === f.task.id && call.params.spentdate === '1970-01-01~2026-10-28' && !call.params.owner))
    assert.equal(analysis.members[1].days[0].actual, 5)
    assert.ok(analysis.risks.some(risk => risk.code === 'HISTORICAL_HOURS_SHORT'))
    assert.ok(!analysis.risks.some(risk => risk.date === query.analysisDate && risk.code.includes('SHORT')))
    const count = f.calls.length
    const current = f.store.readSettings()
    f.store.saveSettings({ expectedRevision: current.revision, patch: { hours: { ...current.settings.hours, exemptions: [{ staffId: '100', date: '2026-10-27', hours: 4, note: '' }] }, projects: [{ ...project, name: '新名称' }] } })
    const recalculated = await f.business.analyze(query)
    assert.equal(f.calls.length, count); assert.equal(analysis.fetchedAt, recalculated.fetchedAt); assert.equal(analysis.snapshotId, recalculated.snapshotId)
    assert.equal(recalculated.members[1].days[0].target, 4); assert.equal(recalculated.snapshot.tasks[0].projectName, '新名称')
    assert.notEqual(analysis.analysisId, recalculated.analysisId)
    assert.equal(f.business.getAnalysis(analysis.analysisId).snapshot.tasks[0].projectName, '测试项目')
  } finally { await f.close() }
})

test('partial actual data stays unknown, failed empty sources cannot claim a complete or safe team', async () => {
  const f = fixture()
  try {
    f.setMode('actual-failed')
    const partial = await f.business.analyze(query)
    assert.equal(partial.status, 'partial'); assert.equal(partial.members[1].days[0].state, 'unknown')
    assert.ok(!partial.risks.some(risk => risk.code === 'HISTORICAL_HOURS_SHORT'))
    f.setMode('all-failed')
    const failed = await f.business.analyze({ ...query, refresh: true })
    assert.equal(failed.status, 'failed'); assert.ok(failed.snapshot.issues.length)
  } finally { await f.close() }
})

test('HTML/SVG escape external content, CSV prevents formulas and Chinese PNG is a real resource', async () => {
  const f = fixture()
  try {
    f.rows.set('task:' + f.task.id, { ...f.task, name: '<script>alert(1)</script> & "中文长标题"', owner: '张三_100' })
    const current = f.store.readSettings()
    f.store.saveSettings({ expectedRevision: current.revision, patch: { members: [{ staffId: '100', name: '\t=HYPERLINK("bad")' }] } })
    const analysis = await f.business.analyze(query)
    const html = generateReport(analysis, f.business.files, 'html'), csv = generateReport(analysis, f.business.files, 'csv')
    assert.doesNotMatch(f.business.files.readFile(html.id).toString(), /<script>|<img[^>]+onerror/)
    assert.match(f.business.files.readFile(html.id).toString(), /&lt;script&gt;/)
    assert.match(f.business.files.readFile(csv.id).toString(), /"'=HYPERLINK/)
    for (const value of ['=1', '+1', '-1', '@SUM(A1)', ' \t=1']) assert.ok(csvCell(value).startsWith('"\''))
    const pngs = renderGantt(analysis, f.business.files, 'png')
    assert.ok(pngs.length)
    const png = f.business.files.readFile(pngs[0].id)
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.readUInt32BE(16) > 280)
    assert.equal(pngs[0].analysisId, analysis.analysisId)
    f.restart()
    assert.equal(f.business.files.getFile(html.id).sha256, html.sha256)
  } finally { await f.close() }
})

test('in-flight receipts and jobs recover as unknown/interrupted without deleting analysis records', async () => {
  const f = fixture()
  try {
    const receipt = f.business.files.reserveOperation({ ...createInput(), requestHash: 'digest', expectedHashes: fieldHashes(createInput().fields), action: 'create' }).receipt
    f.business.files.updateOperation(receipt.operationId, { status: 'in_flight' })
    f.business.files.putJob({ jobId: 'interrupted-job', status: 'running', createdAt: new Date().toISOString() })
    f.restart()
    assert.equal(f.business.files.getOperation(receipt.operationId).status, 'unknown')
    assert.equal(f.business.files.getJob('interrupted-job').status, 'interrupted')
    assert.equal(f.store.db.pragma('user_version', { simple: true }), 3)
  } finally { await f.close() }
})

test('gantt exports paginate by rendered member rows as well as date windows', async () => {
  const f = fixture()
  try {
    const analysis = await f.business.analyze(query)
    const memberIds = Array.from({ length: 100 }, (_, index) => String(index))
    analysis.context.memberIds = memberIds
    analysis.members = memberIds.map(staffId => ({ member: { staffId, name: `成员 ${staffId}` }, days: [], pending: [], historicalShortDays: 0, forecastShortDays: 0 }))
    analysis.snapshot.tasks = [{ ...analysis.snapshot.tasks[0], assigneeIds: memberIds }]
    const pages = ganttSvgs(analysis)
    assert.equal(pages.length, 4)
    assert.ok(pages.every(page => Number(/height="(\d+)"/.exec(page)[1]) < 2300))
    analysis.context.range.end = '2026-12-02'
    assert.ok(ganttSvgs(analysis).length > pages.length)
  } finally { await f.close() }
})

test('analysis jobs cancel reads and successful writes invalidate raw caches while old analyses remain immutable', async () => {
  const f = fixture()
  try {
    const first = await f.business.analyze(query)
    await f.business.write(createInput(), 'create')
    const second = await f.business.analyze(query)
    assert.notEqual(second.snapshotId, first.snapshotId)
    assert.equal(f.business.getAnalysis(first.analysisId).snapshot.tasks.length, 1)
    f.setMode('slow')
    const job = f.business.startAnalysis({ ...query, refresh: true })
    f.business.cancelJob(job.jobId)
    await f.business.close()
    assert.equal(f.business.files.getJob(job.jobId).status, 'cancelled')
  } finally { await f.close() }
})

test('MCP exposes catalog, analysis Apps, writes, artifacts and applies validation to generic calls', async () => {
  const f = fixture(), clients = []
  let service
  f.store.close()
  try {
    service = await startServer({ dataDir: f.dir, port: 0, vault: f.vault, tapdTransport: f.transport })
    const client = new Client({ name: 'p1b-test', version: '1' }), token = readFileSync(join(f.dir, 'access-token'), 'utf8').trim()
    const transport = new StreamableHTTPClientTransport(new URL(service.info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
    await client.connect(transport); clients.push({ client, transport })
    const call = (name, args = {}) => client.callTool({ name, arguments: args })
    const list = await client.listTools()
    assert.ok(list.tools.some(tool => tool.name === 'teamsight_open_analysis' && tool._meta.ui.resourceUri === ANALYSIS_UI_URI))
    const resource = await client.readResource({ uri: ANALYSIS_UI_URI })
    assert.match(resource.contents[0].text, /排期与工时/)
    assert.equal(/<script\b[^>]*\bsrc\s*=|<link\b[^>]*rel="modulepreload"|from\s*["']\.\//.test(resource.contents[0].text), false)
    const unknown = await call('tapd_call_operation', { operationId: 'delete.anything', parameters: {} })
    assert.equal(unknown.structuredContent.code, 'OPERATION_NOT_REGISTERED')
    const bypass = await call('tapd_call_operation', { operationId: 'task.create', parameters: { ...(({ entityType, ...parameters }) => parameters)(createInput()), url: 'https://elsewhere.test' } })
    assert.equal(bypass.isError, true); assert.equal(f.writes(), 0)
    const created = await call('tapd_call_operation', { operationId: 'task.create', parameters: (({ entityType, ...parameters }) => parameters)(createInput()) })
    assert.equal(created.structuredContent.status, 'succeeded')
    const keyConflict = await call('tapd_create_item', { ...createInput(), fields: { name: 'conflicting request' } })
    assert.equal(keyConflict.isError, true); assert.equal(keyConflict.structuredContent.code, 'IDEMPOTENCY_KEY_CONFLICT'); assert.equal(f.writes(), 1)
    const invalidDate = await call('tapd_call_operation', { operationId: 'timesheets.search', parameters: { workspaceId: project.id, start: '2026-02-30', end: '2026-03-02' } })
    assert.equal(invalidDate.isError, true); assert.equal(invalidDate.structuredContent.code, 'INVALID_RANGE')
    let analyzed = (await call('teamsight_analyze_hours', query)).structuredContent
    if (!analyzed.analysisId) {
      const job = await call('teamsight_get_job', { jobId: analyzed.jobId })
      analyzed = job.structuredContent.analysis
    }
    assert.ok(analyzed.analysisId)
    const report = await call('teamsight_generate_report', { analysisId: analyzed.analysisId, format: 'html' })
    const artifact = report.structuredContent.artifacts[0]
    assert.ok(report.content.some(content => content.type === 'resource_link'))
    const file = await client.readResource({ uri: artifact.resourceUri })
    assert.equal(file.contents[0].mimeType, 'text/html')
    assert.match(file.contents[0].text, /区间工时/)
    const empty = await call('teamsight_get_schedule', { start: '2026-02-30', end: '2026-03-01' })
    assert.equal(empty.isError, true)
  } finally {
    for (const entry of clients) { await entry.transport.terminateSession().catch(() => {}); await entry.client.close() }
    await service?.close(); rmSync(f.dir, { recursive: true, force: true })
  }
})
