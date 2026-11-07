import { computeLayout, buildGanttDisplayTasks, filterGanttDisplayTasks, ganttDisplayRows, dateDiffInDays, isWorkingDay, type WorkingCalendar, type GanttDisplayTask, type DailyContribution, type DailyHours, type DateRange, type MemberHours, type ScheduleTask } from '@teamsight/core'

export const taskKey = (task: ScheduleTask) => [task.projectId, task.sourceType, task.id].join(':')
export const hoursNumber = (value: number) => String(Math.floor((value + 1e-9) * 100) / 100)
export type HoursStatus = 'enough' | 'past-short' | 'forecast-short' | 'unknown'
export const statusLabel: Record<HoursStatus, string> = { enough: '工时达标', 'past-short': '历史工时不足', 'forecast-short': '预计工时不足', unknown: '工时未知' }
export function hoursStatus(day: DailyHours, today: string): HoursStatus {
  if (day.target === 0) return 'enough'
  if (day.state === 'unknown' || day.reasons.length || !Number.isFinite(day.total)) return 'unknown'
  return day.total + 1e-9 >= day.target ? 'enough' : day.date < today ? 'past-short' : 'forecast-short'
}
export interface RelatedTask {
  key: string
  task?: ScheduleTask
  scheduled: boolean
  virtual?: boolean
  contribution?: DailyContribution
}
export interface HoursCell {
  key: string
  member: MemberHours
  day: DailyHours
  x: number
  y: number
  width: number
  height: number
  related: RelatedTask[]
  status: HoursStatus
}
const inRange = (date: string, range: DateRange) => date >= range.start && date <= range.end
/** Shared presentation rows keep raw dates intact and align virtual bars with hours. */
export function buildGanttModel(tasks: GanttDisplayTask[], members: MemberHours[], range: DateRange, today: string, labelWidth: number, dayWidth: number, calendar?: WorkingCalendar) {
  const prepared = tasks.length && tasks.every(task => task.displaySpans !== undefined) ? tasks : buildGanttDisplayTasks(tasks, members, range)
  const slots = ganttDisplayRows(filterGanttDisplayTasks(prepared, range, members.map(member => member.member.staffId)))
  const byId = new Map(slots.map(slot => [slot.layoutTask.sourceType + ':' + slot.layoutTask.id, slot]))
  const layoutTasks: ScheduleTask[] = slots.map(slot => slot.layoutTask)
  for (const { member } of members) if (!slots.some(slot => slot.memberId === member.staffId)) {
    layoutTasks.push({ id: 'empty:' + member.staffId, sourceType: 'task', projectId: '', projectName: '', projectColor: '#999999', title: '无已排期任务', assigneeId: member.staffId, assigneeIds: [member.staffId], assigneeName: member.name, startDate: null, dueDate: null, status: '', tapdUrl: '' })
  }
  const layout = computeLayout({ tasks: layoutTasks, range, today,
    config: { labelColumnWidth: labelWidth, dayColumnWidth: dayWidth, taskRowHeight: 42, barHeight: 16 },
    memberOrder: members.map(member => 'staff:' + member.member.staffId), memberNames: new Map(members.map(member => ['staff:' + member.member.staffId, member.member.name])),
    memberKeysOf: task => task.assigneeIds.map(id => 'staff:' + id) })
  const bars = layout.bars.flatMap(bar => {
    const slot = byId.get(bar.taskId)!
    return slot.spans.map(span => {
      const start = span.start < range.start ? range.start : span.start, end = span.end > range.end ? range.end : span.end
      return { ...bar, key: bar.key + ':' + span.kind + ':' + span.start, x: dateDiffInDays(range.start, start) * dayWidth,
        width: (dateDiffInDays(start, end) + 1) * dayWidth, startDate: span.start, dueDate: span.end,
        clippedStart: span.start < range.start, clippedEnd: span.end > range.end, task: slot.task, span }
    }).filter(bar => bar.width > 0)
  })
  const cells: HoursCell[] = []
  for (const member of members) {
    const memberKey = 'staff:' + member.member.staffId
    const header = layout.rows.find(row => row.type === 'member' && row.memberKey === memberKey)!
    const rows = layout.rows.filter(row => row.type === 'task' && row.memberKey === memberKey)
    for (const day of member.days.filter(day => inRange(day.date, range))) {
      const contributions = new Map(day.contributions.filter(row => row.actual !== 0 || row.allocated !== 0).map(row => [row.taskKey, row]))
      const related: RelatedTask[] = []
      const relatedRows = rows.filter(row => {
        if (row.type !== 'task') return false
        const slot = byId.get(row.taskId)
        if (!slot) return false
        const task = slot.task
        const spans = slot.spans.filter(span => span.start <= day.date && span.end >= day.date)
        const contribution = contributions.get(taskKey(task))
        if (!spans.length && !contribution) return false
        related.push({ key: taskKey(task), task, scheduled: spans.some(span => span.kind === 'planned'), virtual: spans.some(span => span.kind === 'actual'), contribution })
        return true
      })
      const first = relatedRows[0] ?? header, last = relatedRows.at(-1) ?? header
      if (!relatedRows.length && !isWorkingDay(day.date, calendar) && day.actual === 0 && day.allocated === 0 && day.total === 0 && day.state !== 'unknown' && !day.reasons.length) continue
      cells.push({ key: member.member.staffId + ':' + day.date, member, day, x: layout.days.indexOf(day.date) * dayWidth + 3,
        y: first.y + 2, width: dayWidth - 6, height: last.y + last.height - first.y - 4, related, status: hoursStatus(day, today) })
    }
  }
  return { layout, bars, cells }
}
