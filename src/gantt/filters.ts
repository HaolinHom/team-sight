import type { DateRange } from './dateUtils';
import { addDays, dateDiffInDays, isValidDateKey } from './dateUtils';
import type { ScheduleTask, WorkItemType } from '@/types/schedule';

/**
 * 看板筛选条件。
 * 三个多选使用 `null` 表示「全选（不筛选）」，数组表示显式选择，`[]` 表示已全部取消。
 */
export interface ScheduleFilters {
  range: DateRange;
  projectIds: string[] | null;
  memberKeys: string[] | null;
  statuses: string[] | null;
}

export interface StatusOption {
  sourceType: WorkItemType;
  value: string;
  count: number;
}

/** 状态筛选使用「来源类型 + 原值」组合键，避免任务与缺陷同名状态被混为一体。 */
export function statusKey(sourceType: WorkItemType, value: string): string {
  return `${sourceType}\u0000${value}`;
}

/** TAPD 常见终态：命中即视为已完成。自定义（含中文）状态一律按未完成处理。 */
const COMPLETED_STATUS_VALUES = ['done', 'closed', 'resolved', 'rejected'];

/** 时间范围上限：超过则截断，避免一次拉取过多数据。 */
export const MAX_RANGE_DAYS = 366;
/** 超过该天数时提示数据量较大。 */
export const LARGE_RANGE_DAYS = 92;

export function createDefaultFilters(range: DateRange): ScheduleFilters {
  return { range, projectIds: null, memberKeys: null, statuses: null };
}

export function isCompletedStatus(status: string): boolean {
  return COMPLETED_STATUS_VALUES.includes(status.trim().toLowerCase());
}

/** 状态选项来自已加载数据，不随筛选收缩（否则选项会越筛越少）。 */
export function collectStatusOptions(tasks: readonly ScheduleTask[]): StatusOption[] {
  const options = new Map<string, StatusOption>();
  for (const task of tasks) {
    const key = `${task.sourceType}\u0000${task.status}`;
    const existing = options.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    options.set(key, { sourceType: task.sourceType, value: task.status, count: 1 });
  }

  return [...options.values()].sort((left, right) => {
    if (left.sourceType !== right.sourceType) return left.sourceType === 'task' ? -1 : 1;
    if (left.count !== right.count) return right.count - left.count;
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  });
}

/** 项目与状态筛选（成员筛选由成员解析负责，因为它决定任务归属而不是可见性位）。 */
export function filterTasks(
  tasks: readonly ScheduleTask[],
  filters: Pick<ScheduleFilters, 'projectIds' | 'statuses'>
): ScheduleTask[] {
  return tasks.filter((task) => {
    if (filters.projectIds && !filters.projectIds.includes(task.projectId)) return false;
    if (filters.statuses && !filters.statuses.includes(statusKey(task.sourceType, task.status))) {
      return false;
    }
    return true;
  });
}

export interface RangeValidation {
  /** 校验通过后的可用范围；null 表示输入非法。 */
  range: DateRange | null;
  /** 非法输入的错误提示。 */
  error: string;
  /** 合法但需要提醒的说明（截断、范围较大）。 */
  note: string;
}

/** 校验并规整时间范围：不自动交换起止日期；超上限时截断并提示。 */
export function validateRange(start: string, end: string): RangeValidation {
  if (!isValidDateKey(start) || !isValidDateKey(end)) {
    return { range: null, error: '请输入有效的起止日期（YYYY-MM-DD）', note: '' };
  }

  const span = dateDiffInDays(start, end);
  if (span < 0) {
    return { range: null, error: '开始日期不能晚于结束日期', note: '' };
  }

  if (span > MAX_RANGE_DAYS) {
    return {
      range: { start, end: addDays(start, MAX_RANGE_DAYS) },
      error: '',
      note: `时间范围已截断为 ${MAX_RANGE_DAYS} 天`,
    };
  }

  if (span > LARGE_RANGE_DAYS) {
    return { range: { start, end }, error: '', note: '时间范围较长，将拉取较多数据' };
  }

  return { range: { start, end }, error: '', note: '' };
}
