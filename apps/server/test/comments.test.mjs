import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { TapdError, commentDescription } from '@teamsight/tapd'
import { openStore } from '../dist/storage.js'
import { createBusiness } from '../dist/business.js'
import { startServer } from '../dist/server.js'

const project = { id: '62119705', name: '隔离评论测试', enabled: true, color: '#167d7f' }
const input = (entityType = 'story', key = 'comments-test') => ({ workspaceId: project.id, entityType, id: '9007199254740993123', content: '中文 <script> & "\'\r\n第二行', idempotencyKey: key })
const ok = data => ({ status: 1, info: 'success', data, httpStatus: 200 })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight-comments-')), secrets = new Map(), rows = new Map(), calls = []
  const vault = { put: (id, value) => secrets.set(id, value), get: id => secrets.get(id) ?? null, remove: id => secrets.delete(id) }
  let store = openStore(dir, vault), business, mode = 'ok', writes = 0, beforePost
  const transport = async (path, params, signal, request) => {
    calls.push({ path, params: { ...params }, method: request?.method ?? 'GET' })
    if (path === '/comments') {
      if (request?.method === 'POST') {
        writes++
        if (mode === 'reject') throw new TapdError('forbidden', 403, 403, 0)
        const row = { ...params, id: String(9007199254740994000n + BigInt(writes)), created: '2026-11-17 12:00:00', modified: '2026-11-17 12:00:00', root_id: params.root_id ?? '0', reply_id: params.reply_id ?? '0' }
        rows.set(row.id, row)
        if (mode === 'timeout') throw new Error('emitted timeout')
        if (mode === 'malformed-post') return ok({})
        return ok({ Comment: row })
      }
      if (mode === 'readback-denied' && params.id && writes) throw new TapdError('denied', 403, 403, 0)
      const selected = params.id ? [rows.get(params.id)].filter(Boolean) : [...rows.values()].filter(row => row.entry_id === params.entry_id && row.workspace_id === params.workspace_id && params.entry_type.split('|').includes(row.entry_type))
      return ok(selected.map(Comment => ({ Comment })))
    }
    if (path === '/users/info') {
      if (mode === 'identity-unknown') return ok({ nick: '张三', name: '张三' })
      if (mode === 'identity-ambiguous') return ok({ nick: '张三_100', name: '李四_200' })
      return ok({ nick: '张三_100', name: '张三' })
    }
    if (path === '/workspaces/users') {
      if (mode === 'directory-denied') throw new TapdError('denied', 403, 403, 0)
      beforePost?.(); beforePost = undefined
      return ok([{ UserWorkspace: { user: '张三_100' } }, { UserWorkspace: { user: '李四_200' } }])
    }
    if (path === '/attachments') {
      if (mode === 'attachments-denied') throw new TapdError('denied', 403, 403, 0)
      return ok([{ Attachment: { id: 'a1', workspace_id: project.id, entry_id: input().id, filename: '报告.pdf' } }])
    }
    if (path === '/attachments/down') return ok({ Attachment: { id: 'a1', workspace_id: project.id, download_url: 'https://files.example/report.pdf' } })
    if (['/stories', '/tasks', '/bugs'].includes(path)) {
      const key = { '/stories': 'Story', '/tasks': 'Task', '/bugs': 'Bug' }[path]
      return ok([{ [key]: { id: params.id, workspace_id: params.workspace_id, name: '工作项' } }])
    }
    throw new Error('unexpected ' + path)
  }
  store.saveSettings({ expectedRevision: 0, credential: 'ISOLATED_COMMENT_SECRET', patch: { projects: [project], tapd: { writeAccess: { operations: ['comment'], fields: [] } } } })
  business = createBusiness(store, dir, transport)
  return { dir, vault, rows, calls, transport, get store() { return store }, get business() { return business }, writes: () => writes, mode: value => { mode = value }, beforePost: fn => { beforePost = fn },
    change(patch) { return store.saveSettings({ expectedRevision: store.readSettings().revision, patch }) },
    async restart() { await business.close(); store.close(); store = openStore(dir, vault); business = createBusiness(store, dir, transport) },
    async close() { await business.close(); store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('story/task/bug comments use the token identity, independent permission and durable deduplication', async () => {
  const f = fixture()
  try {
    for (const [type, expected] of [['story', 'stories'], ['task', 'tasks'], ['bug', 'bug']]) {
      const args = input(type, 'comment-' + type)
      const [first, second] = await Promise.all([f.business.addComment(args), f.business.addComment(args)])
      assert.equal(first.status, 'succeeded'); assert.equal(first.operationId, second.operationId)
      assert.equal(first.actor, '张三_100'); assert.equal(first.targetId, args.id)
      assert.equal(f.rows.get(first.remoteId).entry_type, expected)
      assert.equal(f.rows.get(first.remoteId).description, commentDescription(args.content))
      assert.equal(first.tapdUrl, `https://www.tapd.cn/tapd_fe/${project.id}/${type}/detail/${args.id}`)
      assert.equal((await f.business.listComments(args)).complete, true)
      await assert.rejects(f.business.addComment({ ...args, content: 'different' }), /IDEMPOTENCY_KEY_CONFLICT/)
      const receipt = JSON.stringify(f.business.files.getOperation(first.operationId))
      assert.doesNotMatch(receipt, /ISOLATED_COMMENT_SECRET|第二行|<script>/)
    }
    assert.equal(f.writes(), 3)
    await f.restart()
    assert.equal((await f.business.addComment(input('story', 'comment-story'))).replayed, true)
    assert.equal(f.writes(), 3)
    assert.equal(f.store.db.pragma('user_version', { simple: true }), 4)
  } finally { await f.close() }
})

test('task and bug replies keep their entity type and validated thread relationship', async () => {
  const f = fixture()
  try {
    for (const [type, entryType] of [['task', 'tasks'], ['bug', 'bug']]) {
      const parent = await f.business.addComment(input(type, 'reply-parent-' + type))
      const reply = await f.business.addComment({ ...input(type, 'reply-child-' + type), replyToId: parent.remoteId })
      assert.equal(reply.status, 'succeeded')
      const row = f.rows.get(reply.remoteId)
      assert.equal(row.entry_type, entryType); assert.equal(row.root_id, parent.remoteId); assert.equal(row.reply_id, parent.remoteId)
    }
    assert.equal(f.writes(), 4)
  } finally { await f.close() }
})

test('replies derive root/reply IDs and reject another target or invalid root before POST', async () => {
  const f = fixture()
  try {
    const first = await f.business.addComment(input())
    const reply = await f.business.addComment({ ...input('story', 'reply-test'), replyToId: first.remoteId })
    const nested = await f.business.addComment({ ...input('story', 'nested-test'), replyToId: reply.remoteId })
    assert.equal(reply.status, 'succeeded'); assert.equal(nested.status, 'succeeded')
    assert.equal(f.rows.get(nested.remoteId).root_id, first.remoteId)
    assert.equal(f.rows.get(nested.remoteId).reply_id, reply.remoteId)
    for (const type of ['task', 'bug']) {
      const result = await f.business.addComment({ ...input(type, 'other-' + type), replyToId: first.remoteId })
      assert.equal(result.status, 'failed'); assert.equal(result.code, 'COMMENT_TARGET_MISMATCH')
    }
    f.rows.set('other', { ...f.rows.get(first.remoteId), id: 'other', workspace_id: 'other' })
    assert.equal((await f.business.addComment({ ...input('story', 'other-project'), replyToId: 'other' })).status, 'failed')
    f.rows.set('invalid', { ...f.rows.get(first.remoteId), id: 'invalid', root_id: reply.remoteId })
    assert.equal((await f.business.addComment({ ...input('story', 'invalid-root'), replyToId: 'invalid' })).code, 'INVALID_COMMENT_ROOT')
    assert.equal(f.writes(), 3)
  } finally { await f.close() }
})

test('missing permissions, inaccessible scope, unresolved identity and configuration changes block writes', async () => {
  const f = fixture()
  try {
    f.change({ tapd: { writeAccess: { operations: ['create', 'update'], fields: ['description'] } } })
    await assert.rejects(f.business.addComment(input()), /WRITE_NOT_ALLOWED/)
    f.change({ tapd: { writeAccess: { operations: ['comment'], fields: [] } }, projects: [{ ...project, enabled: false }] })
    await assert.rejects(f.business.addComment(input()), /WRITE_NOT_ALLOWED/)
    assert.equal((await f.business.listComments(input())).complete, true)
    f.change({ projects: [{ ...project, available: false }] })
    await assert.rejects(f.business.listComments(input()), /PROJECT_NOT_ALLOWED/)
    f.change({ projects: [project] })
    for (const mode of ['identity-unknown', 'identity-ambiguous', 'directory-denied']) {
      f.mode(mode)
      assert.equal((await f.business.addComment(input('story', mode))).status, 'failed')
    }
    f.mode('ok'); f.beforePost(() => f.change({ tapd: { writeAccess: { operations: [] } } }))
    assert.equal((await f.business.addComment(input('story', 'config-change'))).code, 'CONFIG_CHANGED')
    assert.equal(f.writes(), 0)
    const legacy = f.change({ tapd: { writeAccess: { operations: ['create', 'update', 'upload'], fields: [] } } })
    assert.deepEqual(legacy.settings.tapd.writeAccess.operations, ['create', 'update'])
  } finally { await f.close() }
})

test('timeout and malformed acknowledgement stay unknown across restart and are never reissued', async () => {
  const f = fixture()
  try {
    for (const mode of ['timeout', 'malformed-post', 'readback-denied']) {
      f.mode(mode)
      const args = input('story', 'comment-' + mode), receipt = await f.business.addComment(args), candidate = [...f.rows.keys()].at(-1)
      assert.equal(receipt.status, 'unknown')
      await f.restart(); f.mode('ok')
      const count = f.writes()
      assert.equal((await f.business.addComment(args)).status, 'unknown'); assert.equal(f.writes(), count)
      assert.equal((await f.business.verifyOperation(receipt.operationId, candidate)).status, 'succeeded')
      assert.equal(f.writes(), count)
    }
    f.mode('reject')
    assert.equal((await f.business.addComment(input('story', 'reject-test'))).status, 'failed')
  } finally { await f.close() }
})

test('verification checks author, body, reply and target, and refuses a changed credential', async () => {
  const f = fixture()
  try {
    f.mode('timeout'); const receipt = await f.business.addComment(input()), candidate = [...f.rows.keys()][0], original = f.rows.get(candidate)
    f.mode('ok')
    for (const change of [{ description: '<p>other</p>' }, { author: '李四_200' }, { reply_id: 'other' }]) {
      f.rows.set(candidate, { ...original, ...change })
      assert.equal((await f.business.verifyOperation(receipt.operationId, candidate)).status, 'unknown')
    }
    f.rows.set(candidate, { ...original, entry_id: 'another' })
    await assert.rejects(f.business.verifyOperation(receipt.operationId, candidate), /COMMENT_TARGET_MISMATCH/)
    f.rows.set(candidate, original)
    f.store.saveSettings({ expectedRevision: f.store.readSettings().revision, patch: {}, credential: 'DIFFERENT_ISOLATED_SECRET' })
    await assert.rejects(f.business.verifyOperation(receipt.operationId, candidate), /CONNECTION_CHANGED/)
    assert.equal(f.writes(), 1)
  } finally { await f.close() }
})

test('MCP common and generic tools share authorization, validation, receipts and existing attachment reads', async () => {
  const f = fixture()
  await f.business.close(); f.store.close()
  let service, client, transport
  try {
    service = await startServer({ dataDir: f.dir, port: 0, vault: f.vault, tapdTransport: f.transport })
    client = new Client({ name: 'comment-test', version: '1' })
    transport = new StreamableHTTPClientTransport(new URL(service.info.url), { requestInit: { headers: { Authorization: 'Bearer ' + readFileSync(join(f.dir, 'access-token'), 'utf8').trim() } } })
    await client.connect(transport)
    const call = (name, args) => client.callTool({ name, arguments: args })
    const tools = (await client.listTools()).tools
    assert.equal(tools.find(tool => tool.name === 'tapd_add_comment').annotations.idempotentHint, true)
    assert.equal(tools.find(tool => tool.name === 'tapd_list_comments').annotations.readOnlyHint, true)
    const created = await call('tapd_add_comment', input())
    assert.equal(created.structuredContent.status, 'succeeded')
    const repeated = await call('tapd_call_operation', { operationId: 'comments.create', parameters: input() })
    assert.equal(repeated.structuredContent.operationId, created.structuredContent.operationId); assert.equal(f.writes(), 1)
    const listed = await call('tapd_call_operation', { operationId: 'comments.list', parameters: { workspaceId: project.id, entityType: 'story', id: input().id } })
    assert.equal(listed.structuredContent.rows.length, 1)
    const invalid = await call('tapd_call_operation', { operationId: 'comments.create', parameters: { ...input(), author: 'spoofed' } })
    assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.code, 'INVALID_ARGUMENTS')
    assert.equal((await call('tapd_add_comment', { ...input(), content: ' \n ' })).isError, true)
    assert.equal((await call('tapd_call_operation', { operationId: 'attachments.upload', parameters: {} })).structuredContent.code, 'OPERATION_NOT_REGISTERED')
    assert.equal((await call('tapd_call_operation', { operationId: 'attachments.list', parameters: { workspaceId: project.id, entryId: input().id } })).structuredContent.rows[0].filename, '报告.pdf')
    assert.equal((await call('tapd_call_operation', { operationId: 'attachments.download_link', parameters: { workspaceId: project.id, id: 'a1' } })).structuredContent.expiresAfterSeconds, 300)
    f.mode('attachments-denied')
    assert.equal((await call('tapd_call_operation', { operationId: 'attachments.list', parameters: { workspaceId: project.id, entryId: input().id } })).structuredContent.complete, false)
    const settings = (await call('teamsight_read_settings', {})).structuredContent
    await call('teamsight_save_settings', { expectedRevision: settings.revision, patch: { tapd: { writeAccess: { operations: [] } } } })
    assert.equal((await call('tapd_call_operation', { operationId: 'comments.create', parameters: input('story', 'no-permission') })).structuredContent.code, 'WRITE_NOT_ALLOWED')
    assert.equal(f.writes(), 1)
  } finally {
    await transport?.terminateSession().catch(() => {}); await client?.close(); await service?.close(); rmSync(f.dir, { recursive: true, force: true })
  }
})
