import { hoursTaskKey } from './statistics.js'
import { resolveDateIssue } from './layout.js'
import type { DateRange, ScheduleTask } from './types.js'
import type { MemberHours } from './hoursTypes.js'

export interface ContributionItem {
  taskKey: string
  task?: ScheduleTask
  projectName?: string
  projectColor?: string
  warning?: string
}
export interface DisplaySpan {
  memberId: string
  memberName: string
  start: string
  end: string
  kind: 'planned' | 'actual'
  actualDays: { date: string; hours: number }[]
}
export interface GanttDisplayTask extends ScheduleTask {
  displaySpans?: DisplaySpan[]
  /** Legacy input only; unscheduled items without actual hours no longer create rows. */
  displayWarning?: string
}

/** Presentation only: source dates/owners and all hours calculations stay untouched. */
export function buildGanttDisplayTasks(tasks: ScheduleTask[], members: MemberHours[], range: DateRange, items: ContributionItem[] = []): GanttDisplayTask[] {
  const sources = new Map(tasks.map(task => [hoursTaskKey(task), task]))
  const warnings = new Map(items.map(item => [item.taskKey, item.warning]))
  for (const item of items) if (item.task && !sources.has(item.taskKey)) sources.set(item.taskKey, item.task)
  const actuals = new Map<string, Map<string, Map<string, number>>>()
  for (const member of members) for (const day of member.days) {
    if (day.date < range.start || day.date > range.end) continue
    for (const row of day.contributions) {
      if (!Number.isFinite(row.actual) || row.actual <= 0) continue
      if (!actuals.has(row.taskKey)) actuals.set(row.taskKey, new Map())
      const owners = actuals.get(row.taskKey)!
      if (!owners.has(member.member.staffId)) owners.set(member.member.staffId, new Map())
      const dates = owners.get(member.member.staffId)!
      dates.set(day.date, (dates.get(day.date) ?? 0) + row.actual)
      if (!sources.has(row.taskKey)) {
        const [projectId, type, id] = row.taskKey.split(':')
        if (!projectId || !id || !['task', 'bug'].includes(type)) continue
        const project = tasks.find(task => task.projectId === projectId) ?? items.find(item => item.task?.projectId === projectId)?.task
        const metadata = items.find(item => item.taskKey === row.taskKey)
        sources.set(row.taskKey, { id, projectId, sourceType: type as 'task' | 'bug', title: (type === 'bug' ? '缺陷 #' : '任务 #') + id,
          projectName: metadata?.projectName ?? project?.projectName ?? projectId, projectColor: metadata?.projectColor ?? project?.projectColor ?? '#999999', assigneeId: null, assigneeIds: [], assigneeName: '未知', startDate: null, dueDate: null, status: '',
          tapdUrl: 'https://www.tapd.cn/tapd_fe/' + projectId + '/' + type + '/detail/' + id })
        warnings.set(row.taskKey, warnings.get(row.taskKey) ?? '工作项资料未获取，按已知工时展示')
      }
    }
  }
  return [...sources].map(([key, task]) => {
    const displaySpans: DisplaySpan[] = []
    for (const { member } of members) {
      const actualDays = [...(actuals.get(key)?.get(member.staffId) ?? [])].map(([date, hours]) => ({ date, hours })).sort((a, b) => a.date.localeCompare(b.date))
      const base = { memberId: member.staffId, memberName: member.name }
      if (resolveDateIssue(task)) {
        if (actualDays.length) displaySpans.push({ ...base, start: actualDays[0].date, end: actualDays.at(-1)!.date, kind: 'actual', actualDays })
      } else {
        const owner = task.assigneeIds.includes(member.staffId)
        if (owner) displaySpans.push({ ...base, start: task.startDate!, end: task.dueDate!, kind: 'planned', actualDays: actualDays.filter(day => day.date >= task.startDate! && day.date <= task.dueDate!) })
        for (const day of actualDays) if (!owner || day.date < task.startDate! || day.date > task.dueDate!) {
          displaySpans.push({ ...base, start: day.date, end: day.date, kind: 'actual', actualDays: [day] })
        }
      }
    }
    return { ...task, displaySpans, ...(warnings.get(key) ? { displayWarning: warnings.get(key) } : {}) }
  })
}

export function filterGanttDisplayTasks(tasks: GanttDisplayTask[], range: DateRange, memberIds?: string[], projectIds?: string[]) {
  return tasks.filter(task => !projectIds?.length || projectIds.includes(task.projectId)).map(task => ({ ...task,
    displaySpans: task.displaySpans?.filter(span => (!memberIds?.length || memberIds.includes(span.memberId)) && span.start <= range.end && span.end >= range.start),
  })).filter(task => task.displaySpans?.length)
}

/** A private layout clone per member gives each item one row, even with multiple bars. */
export function ganttDisplayRows(tasks: GanttDisplayTask[]) {
  return tasks.flatMap((task, index) => [...new Set(task.displaySpans?.map(span => span.memberId) ?? [])].map(memberId => {
    const spans = task.displaySpans?.filter(span => span.memberId === memberId) ?? []
    const start = spans.map(span => span.start).sort()[0] ?? task.startDate, end = spans.map(span => span.end).sort().at(-1) ?? task.dueDate
    return { task, spans, memberId, layoutTask: { ...task, id: task.id + '\u0000' + String(index).padStart(12, '0') + ':' + memberId,
      assigneeIds: [memberId], startDate: start, dueDate: end } }
  }))
}
