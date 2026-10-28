import { isValidDateKey } from './date.js'
import type { ProjectConfig, ScheduleTask, WorkItemType } from './types.js'

export type RawRow = Record<string, unknown>

function text(value: unknown): string { return value === undefined || value === null ? '' : String(value).trim() }
export function normalizeDateKey(value: unknown): string | null {
  const candidate = text(value).slice(0, 10)
  return isValidDateKey(candidate) ? candidate : null
}

export function parseAssignees(value: unknown): Array<{ id: string | null; name: string }> {
  return text(value).split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const match = /^(.*)_(\d+)$/.exec(item)
    return match ? { id: match[2], name: match[1].trim() } : { id: null, name: item }
  })
}

export function buildTapdUrl(workspaceId: string, type: WorkItemType, id: string): string {
  return `https://www.tapd.cn/tapd_fe/${workspaceId}/${type === 'task' ? 'task' : 'bug'}/detail/${id}`
}

export function mapScheduleRow(row: RawRow, project: ProjectConfig, type: WorkItemType, members: Record<string, string> = {}): ScheduleTask | null {
  const id = text(row.id)
  if (!id) return null
  const assignees = parseAssignees(type === 'task' ? row.owner : row.current_owner)
  const primary = assignees[0] ?? { id: null, name: '' }
  const assigneeIds = [...new Set(assignees.map(item => item.id).filter((item): item is string => Boolean(item)))]
  return {
    id,
    sourceType: type,
    title: text(type === 'task' ? row.name : row.title) || '(无标题)',
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    assigneeId: primary.id,
    assigneeName: primary.id ? members[primary.id] || primary.name : primary.name,
    assigneeIds,
    startDate: normalizeDateKey(row.begin),
    dueDate: normalizeDateKey(row.due),
    status: text(row.status),
    priority: text(row.priority_label) || undefined,
    effort: text(row.effort) || undefined,
    tapdUrl: buildTapdUrl(project.id, type, id),
    rawStatus: text(row.status),
  }
}

export function dedupeScheduleTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  const seen = new Set<string>()
  return tasks.filter(task => {
    const key = `${task.sourceType}:${task.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
