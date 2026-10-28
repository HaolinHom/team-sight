import { buildTapdUrl, mapScheduleRow, type ProjectConfig, type RawRow, type ScheduleTask, type WorkItemType } from '@teamsight/core'

export const fieldsFor = (type: WorkItemType) => type === 'task'
  ? 'id,name,workspace_id,owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,completed'
  : 'id,title,workspace_id,current_owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,closed'

export function rowsOf(data: unknown, type: WorkItemType): RawRow[] {
  if (!Array.isArray(data)) return []
  const key = type === 'task' ? 'Task' : 'Bug'
  return data.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : null)
    .filter((row): row is RawRow => Boolean(row) && typeof row === 'object')
}

export function mapRows(rows: RawRow[], project: ProjectConfig, type: WorkItemType, members: Record<string, string> = {}): ScheduleTask[] {
  return rows.map(row => mapScheduleRow(row, project, type, members)).filter((task): task is ScheduleTask => Boolean(task))
}

export function mapSingleRow(row: RawRow, project: ProjectConfig, type: WorkItemType, members: Record<string, string> = {}): ScheduleTask | null {
  return mapScheduleRow(row, project, type, members)
}

export { buildTapdUrl }
