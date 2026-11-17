import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { TapdClient, commentDescription, operations, operationInput } from '../dist/index.js'

const ok = data => ({ status: 1, info: 'success', data, httpStatus: 200 })
const row = (id, entryType = 'stories') => ({ id, workspace_id: '1', entry_id: '9007199254740993123', entry_type: entryType, author: '中文_100', description: '<p>正文<img src="/tfl/test.png"><a href="/attachments/42">报告.pdf</a></p>', root_id: '0', reply_id: '0' })

test('comments paginate without losing large IDs or existing material references and include bug remarks', async () => {
  const calls = []
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (path, params) => {
    calls.push({ path, params })
    const type = params.entry_type === 'bug|bug_remark' ? 'bug_remark' : params.entry_type
    return ok(Array.from({ length: params.page === '1' ? 200 : 1 }, (_, index) => ({ Comment: row(String(BigInt(params.page) * 1000n + BigInt(index)), type) })))
  } })
  for (const [type, remote] of [['story', 'stories'], ['task', 'tasks'], ['bug', 'bug|bug_remark']]) {
    const result = await client.comments('1', type, row('1').entry_id)
    assert.equal(result.complete, true); assert.equal(result.rows.length, 201)
    assert.equal(result.rows[0].entry_id, '9007199254740993123')
    assert.deepEqual(result.rows[0].materials, { inlineImages: ['/tfl/test.png'], references: ['/attachments/42'] })
    assert.equal(calls.at(-1).params.entry_type, remote)
    assert.equal(calls.at(-1).params.limit, '200')
  }
  assert.ok(calls.every(call => call.path === '/comments'))
})

test('comment pagination reports denied, repeated, mismatched and malformed responses as incomplete', async () => {
  let mode = 'denied'
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async () => {
    if (mode === 'denied') return { status: 0, httpStatus: 403, info: 'denied', data: null }
    if (mode === 'malformed') return ok({ Comment: row('1') })
    if (mode === 'mismatch') return ok([{ Comment: row('1') }, { Comment: { ...row('2'), workspace_id: 'other' } }, { Comment: { ...row('3'), entry_id: 'other' } }, { Comment: row('4', 'tasks') }])
    return ok(Array.from({ length: 200 }, (_, index) => ({ Comment: row(String(index)) })))
  } })
  const denied = await client.comments('1', 'story', row('1').entry_id)
  assert.equal(denied.complete, false); assert.equal(denied.httpStatus, 403)
  mode = 'malformed'; assert.equal((await client.comments('1', 'story', row('1').entry_id)).complete, false)
  mode = 'mismatch'
  const mismatch = await client.comments('1', 'story', row('1').entry_id)
  assert.equal(mismatch.error, 'COMMENT_FILTER_MISMATCH'); assert.equal(mismatch.complete, false); assert.equal(mismatch.rows.length, 1)
  mode = 'repeated'
  const repeated = await client.comments('1', 'story', row('1').entry_id)
  assert.equal(repeated.complete, false); assert.match(repeated.error, /REPEATED/)
})

test('single-comment lookup rejects another target, duplicate IDs and absent rows', async () => {
  let data = [{ Comment: row('c1') }]
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async () => ok(data) })
  assert.equal((await client.getComment('1', 'story', row('1').entry_id, 'c1')).id, 'c1')
  await assert.rejects(client.getComment('1', 'task', row('1').entry_id, 'c1'), /COMMENT_TARGET_MISMATCH/)
  data = [data[0], data[0]]; await assert.rejects(client.getComment('1', 'story', row('1').entry_id, 'c1'), /COMMENT_NOT_FOUND/)
  data = []; await assert.rejects(client.getComment('1', 'story', row('1').entry_id, 'c1'), /COMMENT_NOT_FOUND/)
})

test('Bearer comment POST uses form encoding, escaped multiline text and never retries a mutation', async () => {
  const requests = []
  let fail = false
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ headers: req.headers, method: req.method, url: req.url, params: Object.fromEntries(new URLSearchParams(body)) })
    res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(fail ? { status: 0 } : ok({ Comment: row('c1') })))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const client = new TapdClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, getToken: () => 'isolated-secret' })
    const fields = { workspace_id: '1', entry_type: 'stories', entry_id: row('1').entry_id, author: '中文_100', description: commentDescription('中文 <script> & "单引号\'"\r\n第二行') }
    await client.addComment(fields)
    assert.equal(requests[0].headers.authorization, 'Bearer isolated-secret')
    assert.equal(requests[0].headers['content-type'], 'application/x-www-form-urlencoded')
    assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].url, '/comments')
    assert.equal(requests[0].params.description, '<p>中文 &lt;script&gt; &amp; &quot;单引号&#39;&quot;<br />第二行</p>')
    fail = true; await assert.rejects(client.addComment(fields)); assert.equal(requests.length, 2)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('catalog schemas expose only comment read/create and disallow author, raw HTML fields and uploads', () => {
  assert.equal(operations.find(op => op.id === 'comments.list').pagination, 'page-200-max-50')
  assert.equal(operations.find(op => op.id === 'comments.create').encoding, 'form')
  const input = { workspaceId: '1', entityType: 'bug', id: '2', content: '中文', idempotencyKey: 'comment-test' }
  for (const extra of [{ author: 'someone' }, { description: '<img>' }, { attachments: [] }]) assert.throws(() => operationInput('comments.create').parse({ ...input, ...extra }))
  assert.throws(() => operationInput('comments.create').parse({ ...input, content: ' \n ' }))
  assert.ok(!operations.some(op => /upload|comments.update|comments.delete/.test(op.id)))
})
