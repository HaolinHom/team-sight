export type DateIssue = 'missing-both' | 'missing-start' | 'missing-due' | 'reversed'

export type WorkItemType = 'task' | 'bug'

export interface DateRange { start: string; end: string }

export interface ProjectConfig {
  id: string
  name: string
  enabled: boolean
  color: string
  alias?: string
  order?: number
  available?: boolean
}

export interface MemberEntry { staffId: string; name: string; account?: string; enabled?: boolean; order?: number }
export interface MemberGroup { id: string; name: string; memberIds: string[]; testing?: boolean }

export interface HoursSettings {
  dailyRequiredHours: number
  completedStates: Array<{ projectId: string; type: WorkItemType; values: string[] }>
}

export type { ChinaCalendarSettings } from './calendar.js'
import type { ChinaCalendarSettings } from './calendar.js'

export interface TapdSettings {
  baseUrl: string
  defaultTypes: WorkItemType[]
  writeAccess?: { operations: Array<'create' | 'update'>; fields: string[] }
}

export interface TeamSightSettings {
  schemaVersion: number
  teamName: string
  timeZone: 'Asia/Shanghai' | 'UTC'
  projects: ProjectConfig[]
  members: MemberEntry[]
  groups?: MemberGroup[]
  defaultGroupId?: string
  currentUser?: MemberEntry
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
  dateIssue?: DateIssue
  status: string
  priority?: string
  effort?: string
  tapdUrl: string
  hours?: { estimate: number | null; estimateMissing: boolean; actual: number | null; actualCoverage: 'cumulative' | 'period'; remaining: number | null }
  storyId?: string
  description?: string
  createdAt?: string
  modifiedAt?: string
  completedAt?: string
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


export interface BasicQueryResult {
  status: 'complete' | 'partial' | 'failed'
  fetchedAt: string
  tasks: ScheduleTask[]
  errors: Array<{ projectId: string; type: WorkItemType; message: string; status: number }>
}
