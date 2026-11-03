import { type DateRange } from './date.js';
import type { GanttLayout, GanttLayoutConfig, GanttMemberGroup } from './ganttTypes.js';
import type { DateIssue, ScheduleTask } from './types.js';
export declare const DEFAULT_LAYOUT_CONFIG: GanttLayoutConfig;
export interface ComputeLayoutInput {
    tasks: ScheduleTask[];
    range: DateRange;
    collapsedMemberKeys?: readonly string[];
    config?: Partial<GanttLayoutConfig>;
    today?: string;
    /**
     * 任务归属的成员键列表。默认按任务第一个负责人归组；
     * 传入配置成员解析器后，多负责人任务会在多个成员分组下各占一行。
     */
    memberKeysOf?: (task: ScheduleTask) => string[];
    /** 成员键 -> 展示名，用于配置成员分组标题。 */
    memberNames?: ReadonlyMap<string, string>;
    /** 优先展示的成员键顺序；未列出的成员沿用姓名排序。 */
    memberOrder?: readonly string[];
}
/** 稳定成员键：优先工号；无工号时退回 `name:<姓名>`，同名单列不合并。 */
export declare function resolveMemberKey(task: Pick<ScheduleTask, 'assigneeId' | 'assigneeName'>): string;
export declare function resolveDateIssue(task: ScheduleTask): DateIssue | undefined;
/** 按成员分组：优先配置顺序，否则按中文排序，未分配成员固定排最后。 */
export declare function groupTasksByMember(tasks: ScheduleTask[], options?: Pick<ComputeLayoutInput, 'memberKeysOf' | 'memberNames' | 'memberOrder'>): GanttMemberGroup[];
/** 唯一的几何数据来源：行高、纵坐标、任务条坐标都在这里一次算清。 */
export declare function computeLayout(input: ComputeLayoutInput): GanttLayout;
