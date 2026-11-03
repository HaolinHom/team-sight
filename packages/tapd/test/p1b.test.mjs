import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { TapdClient, RequestQueue, operations } from '../dist/index.js'
const ok = data => ({ status: 1, info: 'success', data, httpStatus: 200 })

test('pagination preserves all 201 records and detects repeated pages and malformed lists', async () => {
  let mode = 'complete'
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (path, params) => {
    if (path.endsWith('/count')) return ok({ count: mode === 'complete' ? 201 : 1000 })
    if (mode === 'invalid') return ok({ unexpected: [] })
    const offset = mode === 'repeated' ? 0 : (Number(params.page) - 1) * 200
    const length = mode === 'complete' && offset ? 1 : 200
    return ok(Array.from({ length }, (_, index) => ({ Task: { id: String(10n ** 19n + BigInt(offset + index)) } })))
  } })
  const full = await client.pages('/tasks', { workspace_id: '1' }, 'Task')
  assert.equal(full.complete, true); assert.equal(full.rows.length, 201); assert.equal(full.rows[0].id, '10000000000000000000')
  mode = 'repeated'
  const repeated = await client.pages('/tasks', { workspace_id: '1' }, 'Task')
  assert.equal(repeated.complete, false); assert.equal(repeated.rows.length, 200); assert.match(repeated.error, /REPEATED/)
  mode = 'invalid'
  assert.equal((await client.pages('/tasks', { workspace_id: '1' }, 'Task')).complete, false)
})

test('pagination budget is explicit after 50 full pages when count cannot prove convergence', async () => {
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (path, params) => path.endsWith('/count') ? ok({}) : ok(Array.from({ length: 200 }, (_, index) => ({ Task: { id: String((Number(params.page) - 1) * 200 + index) } }))) })
  const result = await client.pages('/tasks', { workspace_id: '1' }, 'Task')
  assert.equal(result.complete, false); assert.equal(result.rows.length, 10000); assert.equal(result.error, 'PAGE_BUDGET_EXCEEDED_50')
})

test('a short page cannot claim completeness when the count still contains missing rows', async () => {
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (path, params) => path.endsWith('/count') ? ok({ count: 205 }) : ok(Array.from({ length: params.page === '1' ? 200 : 1 }, (_, index) => ({ Task: { id: String((Number(params.page) - 1) * 200 + index) } }))) })
  const result = await client.pages('/tasks', { workspace_id: '1' }, 'Task')
  assert.equal(result.complete, false); assert.equal(result.rows.length, 201)
  assert.equal(result.error, 'COUNT_MISMATCH_OR_TRUNCATED_PAGE')
})

test('story search translates an offset consistently with task search', async () => {
  let observed
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (_path, params) => { observed = params; return ok([]) } })
  await client.searchRaw('1', 'story', { limit: 25, offset: 50 })
  assert.equal(observed.page, '3'); assert.equal(observed.limit, '25')
})

test('one global queue bounds requests from multiple clients to three', async () => {
  const queue = new RequestQueue(3)
  let active = 0, maximum = 0
  const transport = async () => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--; return ok([])
  }
  const clients = Array.from({ length: 2 }, () => new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport, queue }))
  await Promise.all(Array.from({ length: 12 }, (_, index) => clients[index % 2].listProjects()))
  assert.equal(maximum, 3)
})

test('native HTTP transport uses Bearer plus POST form encoding and never retries a lost write', async () => {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ method: req.method, path: req.url, headers: req.headers, body })
    if (body.includes('name=lost')) { req.socket.destroy(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(ok({ Story: { id: '101999999999999999999' } })))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const client = new TapdClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, getToken: () => 'ISOLATED_AUTH' })
    const created = await client.writeItem('62119705', 'story', { name: '中文 & 标题', description: 'x=y & z' })
    assert.equal(created.id, '101999999999999999999')
    assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].path, '/stories')
    assert.equal(requests[0].headers.authorization, 'Bearer ISOLATED_AUTH')
    assert.match(requests[0].headers['content-type'], /application\/x-www-form-urlencoded/)
    assert.equal(new URLSearchParams(requests[0].body).get('name'), '中文 & 标题')
    await assert.rejects(client.writeItem('62119705', 'story', { name: 'lost' }))
    assert.equal(requests.length, 2)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('operation directory records the documented POST update endpoints and schemas', () => {
  for (const type of ['story', 'task']) {
    const entry = operations.find(entry => entry.id === type + '.update')
    assert.equal(entry.method, 'POST'); assert.equal(entry.encoding, 'form')
    assert.ok(entry.inputSchema.required.includes('expectedDigest'))
    assert.equal(entry.inputSchema.additionalProperties, false)
  }
  assert.ok(!operations.some(entry => /delete|permissions/.test(entry.id)))
})

test('documented histories use WorkitemChange at 100 rows and attachments use 200 without unsupported count calls',async()=>{
 const calls=[];let denied=false
 const client=new TapdClient({baseUrl:'https://api.tapd.cn',getToken:()=> 'fixture',transport:async(path,params)=>{
  calls.push({path,params})
  if(path==='/attachments')return denied?{status:0,httpStatus:403,data:null}:ok([{Attachment:{id:'a1',workspace_id:'1',entry_id:'s1',filename:'spec.pdf'}}])
  if(path==='/attachments/down')return ok({Attachment:{id:'a1',workspace_id:'1',download_url:'https://files.example/spec.pdf'}})
  return ok([{WorkitemChange:{id:'h1',story_id:'s1',task_id:'t1',created:'2026-11-02 10:00:00',changes:'[]'}}])
 }})
 assert.equal((await client.storyHistory('1','s1')).complete,true);assert.equal((await client.taskHistory('1',['t1'])).complete,true)
 assert.equal(calls[0].params.limit,'100');assert.equal(calls[1].params.limit,'100');assert.equal((await client.attachments('1','s1')).rows[0].filename,'spec.pdf')
 assert.equal(calls[2].params.limit,'200');assert.equal((await client.attachmentLink('1','a1')).expiresAfterSeconds,300)
 assert.equal((await client.storyHistory('1','different')).complete,false)
 denied=true;const unavailable=await client.attachments('1','s1');assert.equal(unavailable.complete,false);assert.equal(unavailable.httpStatus,403)
 assert.ok(!calls.some(call=>call.path.endsWith('/count')))
})
