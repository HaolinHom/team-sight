import type { DateRange } from './date.js';
import type { ScheduleTask, WorkItemType } from './types.js';
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
export declare function statusKey(sourceType: WorkItemType, value: string): string;
/** 时间范围上限：超过则截断，避免一次拉取过多数据。 */
export declare const MAX_RANGE_DAYS = 366;
/** 超过该天数时提示数据量较大。 */
export declare const LARGE_RANGE_DAYS = 92;
export declare function createDefaultFilters(range: DateRange): ScheduleFilters;
export declare function isCompletedStatus(status: string): boolean;
/** 状态选项来自已加载数据，不随筛选收缩（否则选项会越筛越少）。 */
export declare function collectStatusOptions(tasks: readonly ScheduleTask[]): StatusOption[];
/** 项目与状态筛选（成员筛选由成员解析负责，因为它决定任务归属而不是可见性位）。 */
export declare function filterTasks(tasks: readonly ScheduleTask[], filters: Pick<ScheduleFilters, 'projectIds' | 'statuses'>): ScheduleTask[];
export interface RangeValidation {
    /** 校验通过后的可用范围；null 表示输入非法。 */
    range: DateRange | null;
    /** 非法输入的错误提示。 */
    error: string;
    /** 合法但需要提醒的说明（截断、范围较大）。 */
    note: string;
}
/** 校验并规整时间范围：不自动交换起止日期；超上限时截断并提示。 */
export declare function validateRange(start: string, end: string): RangeValidation;
