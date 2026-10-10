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
  /** HTTP 状态码；0 表示非接口错误（网络异常、运行环境限制等）。 */
  status: number;
  message: string;
}

export interface ScheduleFetchResult {
  tasks: import('@/types/schedule').ScheduleTask[];
  errors: WorkspaceFetchError[];
}
