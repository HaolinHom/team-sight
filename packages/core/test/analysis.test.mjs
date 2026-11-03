import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultSettings, calculateHours, checkRisks, businessDate, validateAnalysisInput, mergeCalendar } from '../dist/index.js'
const members = [{ staffId: '2', name: '乙' }, { staffId: '1', name: '甲' }]
const range = { start: '2026-10-27', end: '2026-10-29' }, today = '2026-10-28'
test('business day is explicit across timezone boundaries and invalid ranges are rejected', () => {
  const now = new Date('2026-10-28T20:00:00Z')
  assert.equal(businessDate('Asia/Shanghai', now), '2026-10-29')
  assert.equal(businessDate('UTC', now), '2026-10-28')
  for (const invalid of [{ start: '2026-02-30', end: '2026-03-01' }, { start: '2026-10-29', end: '2026-10-28' }, { start: '2025-01-01', end: '2027-01-01' }]) assert.throws(() => validateAnalysisInput(invalid, today))
})
test('shared hours/risk rules preserve leave, calendar, member order and open-day progress', () => {
  const settings = createDefaultSettings()
  settings.hours.exemptions = [{ staffId: '1', date: '2026-10-27', hours: 3, note: '' }]
  settings.chinaCalendar = { enabled: true, years: { 2026: { year: 2026, days: { '2026-10-29': { working: false, name: '测试休息日' } }, papers: [], fetchedAt: '2026-01-01T00:00:00Z' } } }
  const snapshot = { tasks: [], records: [], issues: [], status: 'complete' }
  const result = calculateHours({ snapshot, members, settings: settings.hours, range, today, calendar: mergeCalendar(settings.chinaCalendar) })
  assert.deepEqual(result.map(member => member.member.staffId), ['2', '1'])
  assert.equal(result[1].days[0].target, 5); assert.equal(result[1].days[2].target, 0)
  const risks = checkRisks(snapshot, result, settings, today)
  assert.equal(risks.length, 2); assert.ok(risks.every(risk => risk.code === 'HISTORICAL_HOURS_SHORT' && risk.date < today))
})
test('unknown source gaps do not become zero-hours risk findings', () => {
  const settings = createDefaultSettings()
  const snapshot = { tasks: [], records: [], issues: [{ projectId: 'p', affects: 'both', message: 'source unavailable' }], status: 'failed' }
  const result = calculateHours({ snapshot, members, settings: settings.hours, range, today })
  assert.ok(result.every(member => member.days.every(day => day.state === 'unknown')))
  assert.deepEqual(checkRisks(snapshot, result, settings, today), [])
})
