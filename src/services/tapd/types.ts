import type { WorkItemType } from '@/types/schedule';

/** TAPD 统一响应信封。 */
export interface TapdEnvelope<T> {
  status: number;
  data: T;
  info: string;
}

export type RawRow = Record<string, unknown>;

export interface WorkspaceFetchError {
  workspaceId: string;
  type: WorkItemType;
  message: string;
}

export interface ScheduleFetchResult {
  tasks: import('@/types/schedule').ScheduleTask[];
  errors: WorkspaceFetchError[];
}
