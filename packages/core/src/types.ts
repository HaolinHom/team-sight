export type WorkItemType = 'task' | 'bug'

export interface DateRange { start: string; end: string }

export interface ProjectConfig {
  id: string
  name: string
  enabled: boolean
  color: string
}

export interface MemberEntry { staffId: string; name: string }

export interface LeaveExemption {
  staffId: string
  date: string
  hours: number
  note: string
}

export interface HoursSettings {
  dailyRequiredHours: number
  exemptions: LeaveExemption[]
  completedStates: Array<{ projectId: string; type: WorkItemType; values: string[] }>
}

export interface ChinaCalendarSettings {
  enabled: boolean
  years: Record<string, { year: number; days: Record<string, { working: boolean; name: string }>; papers: string[]; fetchedAt: string }>
}

export interface TapdSettings {
  baseUrl: string
  workspaceIds: string[]
  defaultTypes: WorkItemType[]
}

export interface TeamSightSettings {
  schemaVersion: number
  teamName: string
  timeZone: 'Asia/Shanghai' | 'UTC'
  projects: ProjectConfig[]
  members: MemberEntry[]
  hours: HoursSettings
  chinaCalendar: ChinaCalendarSettings
  tapd: TapdSettings
  updatedAt: string
}

export interface ScheduleTask {
  id: string
  sourceType: WorkItemType
  title: string
  projectId: string
  projectName: string
  projectColor: string
  assigneeId: string | null
  assigneeName: string
  assigneeIds: string[]
  startDate: string | null
  dueDate: string | null
  status: string
  priority?: string
  effort?: string
  tapdUrl: string
  rawStatus?: string
}

export interface TimesheetRecord {
  id: string
  projectId: string
  entityType: WorkItemType
  entityId: string
  staffId: string
  spentDate: string
  hours: number
}

export interface DailyHoursSummary {
  date: string
  target: number
  actual: number
  deficit: number
  state: 'short' | 'enough' | 'over' | 'exempt'
}

export interface BasicQueryResult {
  status: 'complete' | 'partial' | 'failed'
  fetchedAt: string
  tasks: ScheduleTask[]
  errors: Array<{ projectId: string; type: WorkItemType; message: string; status: number }>
}
