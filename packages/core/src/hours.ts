import { eachDateKey, isWeekend } from './date.js'
import type { DailyHoursSummary, DateRange, HoursSettings, TimesheetRecord } from './types.js'

export function summarizeDailyHours(input: { range: DateRange; settings: HoursSettings; records: TimesheetRecord[]; staffId: string; calendar?: Record<string, { working: boolean }> }): DailyHoursSummary[] {
  const totals = new Map<string, number>()
  for (const record of input.records) if (record.staffId === input.staffId) totals.set(record.spentDate, (totals.get(record.spentDate) ?? 0) + record.hours)
  const leaves = new Map(input.settings.exemptions.filter(item => item.staffId === input.staffId).map(item => [item.date, item.hours]))
  return eachDateKey(input.range).map(date => {
    const working = input.calendar?.[date]?.working ?? !isWeekend(date)
    const target = working ? Math.max(input.settings.dailyRequiredHours - (leaves.get(date) ?? 0), 0) : 0
    const actual = totals.get(date) ?? 0
    const deficit = Math.max(target - actual, 0)
    const state: DailyHoursSummary['state'] = target === 0 ? 'exempt' : actual < target ? 'short' : actual > target ? 'over' : 'enough'
    return { date, target, actual, deficit, state }
  })
}
