import { computeLayout, type DailyContribution, type DailyHours, type DateRange, type MemberHours, type ScheduleTask } from '@teamsight/core'

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
const scheduled = (task: ScheduleTask, date: string) => !!task.startDate && !!task.dueDate && task.startDate <= date && date <= task.dueDate
const overlaps = (task: ScheduleTask, range: DateRange) => !!task.startDate && !!task.dueDate && task.startDate <= task.dueDate && task.startDate <= range.end && task.dueDate >= range.start
const hasHours = (row: DailyContribution) => row.actual !== 0 || row.allocated !== 0

/** Geometry comes from the shared layout; private display IDs preserve its original ID ordering. */
export function buildGanttModel(tasks: ScheduleTask[], members: MemberHours[], range: DateRange, today: string, labelWidth: number, dayWidth: number) {
  const originals = new Map(tasks.map(task => [taskKey(task), task]))
  const contributors = new Map<string, Set<string>>()
  for (const member of members) for (const day of member.days.filter(day => inRange(day.date, range))) {
    for (const row of day.contributions.filter(hasHours)) {
      if (!contributors.has(row.taskKey)) contributors.set(row.taskKey, new Set())
      contributors.get(row.taskKey)!.add(member.member.staffId)
    }
  }
  const originalsByDisplayId = new Map<string, ScheduleTask>()
  const displayTasks = tasks.filter(task => overlaps(task, range) || contributors.has(taskKey(task))).map((task, index) => {
    const id = task.id + '\u0000' + String(index).padStart(12, '0')
    originalsByDisplayId.set(id, task)
    return { ...task, id, assigneeIds: [...new Set([...(overlaps(task, range) ? task.assigneeIds : []), ...(contributors.get(taskKey(task)) ?? [])])], startDate: overlaps(task, range) ? task.startDate : null, dueDate: overlaps(task, range) ? task.dueDate : null }
  })
  for (const member of members) {
    const staffId = member.member.staffId
    const missing = [...contributors].some(([key, owners]) => !originals.has(key) && owners.has(staffId))
    if (missing || !displayTasks.some(task => task.assigneeIds.includes(staffId))) {
      displayTasks.push({ id: `placeholder:${staffId}`, sourceType: 'task', title: missing ? '未匹配工时来源' : '无已排期任务', projectId: '', projectName: '', projectColor: '#999999', assigneeId: staffId, assigneeIds: [staffId], assigneeName: member.member.name, startDate: null, dueDate: null, status: '', tapdUrl: '' })
    }
  }
  const displayById = new Map(displayTasks.map(task => [`${task.sourceType}:${task.id}`, task]))
  const memberIds = new Set(members.map(member => member.member.staffId))
  const layout = computeLayout({ tasks: displayTasks, range, today, config: { labelColumnWidth: labelWidth, dayColumnWidth: dayWidth, taskRowHeight: 42, barHeight: 16 }, memberOrder: members.map(member => `staff:${member.member.staffId}`), memberNames: new Map(members.map(member => [`staff:${member.member.staffId}`, member.member.name])), memberKeysOf: task => task.assigneeIds.filter(id => memberIds.has(id)).map(id => `staff:${id}`) })
  const bars = layout.bars.flatMap(bar => {
    const task = originalsByDisplayId.get(displayById.get(bar.taskId)?.id ?? '')
    return task && task.assigneeIds.includes(bar.memberKey.slice(6)) && bar.width > 0 ? [{ ...bar, task }] : []
  })
  const cells: HoursCell[] = []
  for (const member of members) {
    const memberKey = `staff:${member.member.staffId}`
    const header = layout.rows.find(row => row.type === 'member' && row.memberKey === memberKey)
    if (!header) continue
    const rows = layout.rows.filter(row => row.type === 'task' && row.memberKey === memberKey)
    for (const day of member.days.filter(day => inRange(day.date, range))) {
      const contributions = new Map(day.contributions.filter(hasHours).map(row => [row.taskKey, row]))
      const related: RelatedTask[] = []
      const relatedRows = rows.filter(row => {
        if (row.type !== 'task') return false
        const display = displayById.get(row.taskId)!
        if (display.id === `placeholder:${member.member.staffId}`) return [...contributions.keys()].some(key => !originals.has(key))
        const task = originalsByDisplayId.get(display.id)!
        const isScheduled = task.assigneeIds.includes(member.member.staffId) && scheduled(task, day.date)
        const contribution = contributions.get(taskKey(task))
        if (!isScheduled && !contribution) return false
        related.push({ key: taskKey(task), task, scheduled: isScheduled, contribution })
        return true
      })
      for (const [key, contribution] of contributions) if (!originals.has(key)) related.push({ key, scheduled: false, contribution })
      const first = relatedRows[0] ?? header, last = relatedRows.at(-1) ?? header
      cells.push({ key: member.member.staffId + ':' + day.date, member, day, x: layout.days.indexOf(day.date) * dayWidth + 3, y: first.y + 2, width: dayWidth - 6, height: last.y + last.height - first.y - 4, related, status: hoursStatus(day, today) })
    }
  }
  return { layout, bars, cells }
}
