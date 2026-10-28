import test from 'node:test'
import assert from 'node:assert/strict'
import { TapdClient, fieldsFor } from '../dist/index.js'

const project = { id: 'p1', name: '项目一', enabled: true, color: '#3b82f6' }

test('TAPD adapter uses the existing task/bug field differences and maps rows', async () => {
  assert.match(fieldsFor('task'), /name/)
  assert.match(fieldsFor('bug'), /title/)
  const calls = []
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async (path, params) => {
    calls.push({ path, params })
    return { status: 1, info: 'success', data: [{ Task: { id: '1', name: '任务', owner: '张三_100', begin: '2026-10-01', due: '2026-10-03', status: 'open' } }] }
  } })
  const result = await client.searchItems({ workspaceId: 'p1', entityType: 'task', keyword: '任务' }, project, { '100': '张三' })
  assert.equal(result.tasks[0].title, '任务')
  assert.equal(result.tasks[0].assigneeName, '张三')
  assert.equal(calls[0].params.name, '任务')
  assert.equal(calls[0].params.page, '1')

  await client.searchItems({ workspaceId: 'p1', entityType: 'task', page: 3, range: { start: '2026-10-01', end: '2026-10-31' } }, project)
  assert.equal(calls[1].params.page, '3')
  assert.equal(calls[1].params.begin, '1970-01-01~2026-10-31')
  assert.equal(calls[1].params.due, '2026-10-01~2999-12-31')

  await client.searchItems({ workspaceId: 'p1', entityType: 'bug', keyword: '缺陷' }, project)
  assert.equal(calls[2].params.title, '缺陷')
})

test('TAPD adapter retries transient errors but does not retry 403', async () => {
  let attempts = 0
  const client = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async () => {
    attempts += 1
    if (attempts < 3) return { status: 500, info: 'busy', data: [] }
    return { status: 1, info: 'success', data: [] }
  } })
  await client.searchItems({ workspaceId: 'p1', entityType: 'task' }, project)
  assert.equal(attempts, 3)

  let deniedAttempts = 0
  const denied = new TapdClient({ baseUrl: 'https://api.tapd.cn', getToken: () => 'test', transport: async () => {
    deniedAttempts += 1
    return { status: 403, info: 'denied', data: [] }
  } })
  await assert.rejects(denied.searchItems({ workspaceId: 'p1', entityType: 'task' }, project), error => error.status === 403)
  assert.equal(deniedAttempts, 1)
})
