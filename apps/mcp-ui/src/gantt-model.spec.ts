import { describe, it, expect } from 'vitest'
import type { DailyHours, MemberHours, ScheduleTask } from '@teamsight/core'
import { buildGanttModel, hoursStatus } from './gantt-model'

const range = { start: '2026-10-01', end: '2026-10-31' }, today = '2026-10-15'
const task = (id: string, start = '2026-10-08', due = start): ScheduleTask => ({ id, sourceType: 'task', projectId: '1', projectName: '项目', projectColor: '#123456', title: id, assigneeId: '100', assigneeIds: ['100'], assigneeName: '成员', startDate: start, dueDate: due, status: 'open', tapdUrl: '' })
const day = (values: Partial<DailyHours> = {}): DailyHours => ({ date: '2026-10-08', leaveHours: 0, actual: 8, allocated: 0, total: 8, target: 8, deficit: 0, basis: 'actual', state: 'enough', contributions: [], reasons: [], ...values })
const member = (days = [day()], staffId = '100'): MemberHours => ({ member: { staffId, name: staffId }, days, pending: [], historicalShortDays: 0, forecastShortDays: 0 })
const build = (tasks: ScheduleTask[], members = [member()]) => buildGanttModel(tasks, members, range, today, 190, 48)

describe('daily hours geometry and source association', () => {
 it('contains all three October 8 task bars inside that day, independent of hours magnitude', () => {
  const model = build([task('1'), task('2'), task('3')]), cell = model.cells[0]!
  expect(cell.x).toBe(7 * 48 + 3); expect(cell.width).toBe(42)
  expect(cell.y).toBe(32); expect(cell.height).toBe(122)
  for (const bar of model.bars) { expect(bar.y).toBeGreaterThan(cell.y); expect(bar.y + bar.height).toBeLessThan(cell.y + cell.height) }
  expect(build([task('1'), task('2'), task('3')], [member([day({ total: 100, actual: 100 })])]).cells[0]!.height).toBe(cell.height)
 })
 it('keeps one enclosing box across intervening rows without treating them as related', () => {
  const model = build([task('1', '2026-10-01', '2026-10-08'), task('2', '2026-10-02'), task('3')])
  expect(model.cells[0]!.related.map(row => row.key)).toEqual(['1:task:1', '1:task:3'])
  expect(model.cells[0]!.height).toBe(122)
 })
 it('unites scheduled tasks and contributions, retains unscheduled names and unknown source keys', () => {
  const unscheduled = { ...task('2'), startDate: null, dueDate: null }
  const model = build([task('1'), unscheduled], [member([day({ contributions: [
   { taskKey: '1:task:2', projectId: '1', actual: 4, allocated: 0, explanation: '' },
   { taskKey: '1:bug:missing', projectId: '1', actual: 4, allocated: 0, explanation: '' },
  ] })])])
  expect(model.cells[0]!.related.map(row => row.key).sort()).toEqual(['1:bug:missing', '1:task:1', '1:task:2'])
  expect(model.layout.rows.some(row => row.type === 'task' && row.title === '未匹配工时来源')).toBe(true)
  expect(model.layout.rows.some(row => row.type === 'task' && row.title === '2')).toBe(true)
  expect(model.bars.map(bar => bar.task.id)).toEqual(['1'])
 })
 it('places an empty day in the member header and does not create a fictitious task bar', () => {
  const model = build([])
  expect(model.cells[0]!.y).toBe(2); expect(model.cells[0]!.height).toBe(26)
  expect(model.cells[0]!.related).toEqual([]); expect(model.bars).toEqual([])
 })
 it('isolates members, duplicates multi-owner tasks and clips cross-window dates', () => {
  const shared = { ...task('1', '2026-09-25', '2026-11-01'), assigneeIds: ['100', '200'] }
  const model = build([shared], [member(), member([day()], '200')])
  expect(model.bars).toHaveLength(2)
  expect(model.bars.every(bar => bar.x === 0 && bar.width === 31 * 48)).toBe(true)
  expect(model.cells[1]!.y).toBeGreaterThan(model.cells[0]!.y)
  expect(shared.startDate).toBe('2026-09-25')
 })
 it('uses full task keys for same IDs in different projects and types', () => {
  const model = build([task('1'), { ...task('1'), projectId: '2' }, { ...task('1'), sourceType: 'bug' }])
  expect(new Set(model.bars.map(bar => bar.key)).size).toBe(3)
  expect(model.cells[0]!.related.map(row => row.key).sort()).toEqual(['1:bug:1', '1:task:1', '2:task:1'])
 })
 it('preserves the shared layout ID ordering across task types and ID prefixes', () => {
  const model = build([{ ...task('10'), sourceType: 'bug' }, task('2'), task('1')])
  expect(model.bars.map(bar => bar.task.id)).toEqual(['1', '10', '2'])
 })
 it('shows another member contribution without assigning that member a scheduled task bar', () => {
  const model = build([task('1')], [member(), member([day({ contributions: [{ taskKey: '1:task:1', projectId: '1', actual: 8, allocated: 0, explanation: '' }] })], '200')])
  expect(model.bars).toHaveLength(1)
  expect(model.cells[1]!.related[0]).toMatchObject({ key: '1:task:1', scheduled: false })
 })
})
describe('daily status uses the analysis date and target', () => {
 it.each([
  [day(), 'enough'], [day({ total: 4 }), 'past-short'],
  [day({ date: today, total: 4 }), 'forecast-short'], [day({ date: '2026-10-20', total: 4 }), 'forecast-short'],
  [day({ target: 0, total: 0, state: 'exempt' }), 'enough'],
  [day({ state: 'unknown' }), 'unknown'], [day({ reasons: [{ message: '来源不完整' }] }), 'unknown'],
 ] as const)('classifies %o as %s', (value, expected) => { expect(hoursStatus(value, today)).toBe(expected) })
})
