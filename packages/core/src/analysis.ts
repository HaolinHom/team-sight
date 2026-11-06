import { assertRange, isValidDateKey } from './date.js'
import { isHoursCompleted } from './hoursSettings.js'
import { hoursTaskKey, parseHours } from './statistics.js'
import type { HoursSnapshot, MemberHours } from './hoursTypes.js'
import type { DateRange, TeamSightSettings } from './types.js'
import type { ContributionItem } from './ganttDisplay.js'

export const MCP_RULES_VERSION = 'teamsight-mcp-hours-v3'
export interface AnalysisContext {
  range: DateRange
  analysisDate: string
  timeZone: string
  projectIds: string[]
  memberIds: string[]
  configRevision: number
  calendarVersion: string
  rulesVersion: string
}
export interface RiskFinding {
  code: 'HISTORICAL_HOURS_SHORT' | 'FORECAST_SHORT' | 'MISSING_SCHEDULE' | 'MISSING_ESTIMATE' | 'OVERDUE'
  message: string
  staffId?: string
  date?: string
  taskKey?: string
  evidence: string[]
}
export interface TeamAnalysis {
  analysisId: string
  snapshotId: string
  createdAt: string
  fetchedAt: string
  context: AnalysisContext
  status: HoursSnapshot['status']
  unit: 'hours'
  snapshot: HoursSnapshot
  members: MemberHours[]
  risks: RiskFinding[]
  limitations: string[]
  /** Worklog references resolved for presentation only; never calculation inputs. */
  contributionItems?: ContributionItem[]
}

export function validateAnalysisInput(range: DateRange, analysisDate: string): void {
  assertRange(range)
  if (!isValidDateKey(analysisDate)) throw new RangeError('INVALID_ANALYSIS_DATE')
}

export function checkRisks(snapshot: HoursSnapshot, members: MemberHours[], settings: TeamSightSettings, today: string): RiskFinding[] {
  const findings: RiskFinding[] = []
  for (const { member, days } of members) for (const day of days) {
    // The open business day is included; uncertain sources cannot prove a deficit.
    if (day.state !== 'short' || day.reasons.length) continue
    const historical = day.date < today
    findings.push({ code: historical ? 'HISTORICAL_HOURS_SHORT' : 'FORECAST_SHORT',
      message: `${member.name} ${day.date} ${historical ? '已填报' : '预计'}工时不足，差 ${day.deficit} 小时`,
      staffId: member.staffId, date: day.date,
      evidence: day.contributions.length ? day.contributions.map(c => c.taskKey) : [`daily:${member.staffId}:${day.date}`],
    })
  }
  for (const task of snapshot.tasks) {
    if (isHoursCompleted(task, settings.hours)) continue
    const key = hoursTaskKey(task)
    const base = { taskKey: key, evidence: [key] }
    if (!task.startDate || !task.dueDate || task.startDate > task.dueDate) findings.push({ ...base, code: 'MISSING_SCHEDULE', message: `「${task.title}」缺少有效排期` })
    if (parseHours(task.effort) === null) findings.push({ ...base, code: 'MISSING_ESTIMATE', message: `「${task.title}」缺少有效预估工时` })
    if (task.dueDate && task.dueDate < today) findings.push({ ...base, code: 'OVERDUE', message: `「${task.title}」未结束且已逾期`, date: task.dueDate })
  }
  return findings
}
