import type { ScheduleTask, WorkItemType } from './schedule';
import type { MemberEntry } from './settings';

export interface HoursSettings {
  dailyRequiredHours: number;
  calendarOverrides: Array<{ date: string; working: boolean; note: string }>;
  exemptions: Array<{ staffId: string; date: string; note: string }>;
  completedStates: Array<{ projectId: string; type: WorkItemType; values: string[] }>;
}

export interface TimesheetRecord {
  id: string;
  projectId: string;
  entityType: WorkItemType;
  entityId: string;
  staffId: string;
  spentDate: string;
  hours: number;
}

/** 范围不明确的问题影响整个对应维度，不能把漏数当成零。 */
export interface HoursIssue {
  projectId: string;
  message: string;
  affects: 'actual' | 'forecast' | 'both';
  staffId?: string;
  date?: string;
  taskKey?: string;
}

export interface HoursSnapshot {
  fetchedAt?: number;
  metrics?: { requests: number; cacheHits: number; fetchMs: number };
  tasks: ScheduleTask[];
  records: TimesheetRecord[];
  issues: HoursIssue[];
  status: 'complete' | 'partial' | 'failed';
}

export interface DailyContribution {
  taskKey: string;
  projectId: string;
  actual: number;
  allocated: number;
  explanation: string;
}

export interface DailyHours {
  date: string;
  actual: number;
  allocated: number;
  total: number;
  target: number;
  deficit: number;
  basis: 'actual' | 'forecast';
  state: 'short' | 'enough' | 'over' | 'exempt' | 'unknown';
  contributions: DailyContribution[];
  reasons: string[];
}

export interface PendingHours {
  task: ScheduleTask;
  hours: number | null;
  reason: string;
  overdue: boolean;
}

export interface MemberHours {
  member: MemberEntry;
  days: DailyHours[];
  pending: PendingHours[];
  historicalShortDays: number;
  forecastShortDays: number;
}
