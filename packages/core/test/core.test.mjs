import test from 'node:test'
import assert from 'node:assert/strict'
import { currentMonthRange, dateDiffInDays, mapScheduleRow } from '../dist/index.js'

test('core keeps natural-date and timezone-independent semantics', () => {
  assert.equal(dateDiffInDays('2026-10-01', '2026-10-03'), 2)
  assert.deepEqual(currentMonthRange(new Date('2026-10-27T16:00:00Z')), { start: '2026-10-01', end: '2026-10-31' })
})


test('schedule mapping matches the old TAPD field conventions', () => {
  const task = mapScheduleRow({ id: '101', name: '联调', owner: '张三_800100001;李四_800100002', begin: '2026-10-01 09:00:00', due: '2026-10-03', status: 'open', effort: '8' }, { id: 'p1', name: '项目一', enabled: true, color: '#3b82f6' }, 'task', { '800100001': '张三' })
  assert.equal(task?.assigneeName, '张三')
  assert.deepEqual(task?.assigneeIds, ['800100001', '800100002'])
  assert.equal(task?.startDate, '2026-10-01')
})
