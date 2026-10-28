import test from 'node:test'
import assert from 'node:assert/strict'
import { currentMonthRange, dateDiffInDays, importLegacySettings, mapScheduleRow, summarizeDailyHours } from '../dist/index.js'

test('core keeps natural-date and timezone-independent semantics', () => {
  assert.equal(dateDiffInDays('2026-10-01', '2026-10-03'), 2)
  assert.deepEqual(currentMonthRange(new Date('2026-10-27T16:00:00Z')), { start: '2026-10-01', end: '2026-10-31' })
})

test('legacy settings import keeps business fields and ignores credential values', () => {
  const result = importLegacySettings({ schemaVersion: 3, teamName: '前端组', timeZone: 'UTC', tapdToken: 'DO_NOT_STORE', hours: { dailyRequiredHours: 7.5 } })
  assert.equal(result.settings.teamName, '前端组')
  assert.equal(result.settings.timeZone, 'UTC')
  assert.equal(result.settings.hours.dailyRequiredHours, 7.5)
  assert.equal(result.ignoredCredential, true)
})

test('schedule mapping matches the old TAPD field conventions', () => {
  const task = mapScheduleRow({ id: '101', name: '联调', owner: '张三_800100001;李四_800100002', begin: '2026-10-01 09:00:00', due: '2026-10-03', status: 'open', effort: '8' }, { id: 'p1', name: '项目一', enabled: true, color: '#3b82f6' }, 'task', { '800100001': '张三' })
  assert.equal(task?.assigneeName, '张三')
  assert.deepEqual(task?.assigneeIds, ['800100001', '800100002'])
  assert.equal(task?.startDate, '2026-10-01')
})

test('hours summary preserves leave deduction and missing actual as zero', () => {
  const days = summarizeDailyHours({ range: { start: '2026-10-05', end: '2026-10-06' }, staffId: '1', settings: { dailyRequiredHours: 8, exemptions: [{ staffId: '1', date: '2026-10-05', hours: 2, note: '' }], completedStates: [] }, records: [{ id: 'r1', projectId: 'p1', entityType: 'task', entityId: 't1', staffId: '1', spentDate: '2026-10-05', hours: 5 }] })
  assert.deepEqual(days.map(day => [day.date, day.target, day.actual, day.state]), [['2026-10-05', 6, 5, 'short'], ['2026-10-06', 8, 0, 'short']])
})
