import type { ScheduleTask, MemberEntry, TimesheetRecord } from './types.js';
export type { LeaveExemption, HoursSettings, TimesheetRecord } from './types.js';

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
  leaveHours: number;
  actual: number;
  allocated: number;
  total: number;
  target: number;
  deficit: number;
  basis: 'actual' | 'forecast';
  state: 'short' | 'enough' | 'over' | 'exempt' | 'unknown';
  contributions: DailyContribution[];
  /** 数据完整性提示，独立于工时状态；达到目标仍可能有待确认项。 */
  reasons: HoursReason[];
}

/** 展示时根据项目 ID 拼接最新配置名称，避免固化在 Worker 结果中。 */
export interface HoursReason {
  message: string;
  projectId?: string;
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
