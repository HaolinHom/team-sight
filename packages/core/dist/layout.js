import { compareDateKeys, dateDiffInDays, eachDateKey, isValidDateKey, maxDateKey, minDateKey, todayKey, } from './date.js';
import { isCompletedStatus } from './filters.js';
export const DEFAULT_LAYOUT_CONFIG = {
    headerHeight: 44,
    memberRowHeight: 30,
    taskRowHeight: 34,
    dayColumnWidth: 40,
    labelColumnWidth: 280,
    barHeight: 18,
};
const UNASSIGNED_MEMBER_KEY = 'unassigned';
const UNASSIGNED_MEMBER_NAME = '未分配成员';
const memberCollator = new Intl.Collator('zh-Hans-CN');
/** 稳定成员键：优先工号；无工号时退回 `name:<姓名>`，同名单列不合并。 */
export function resolveMemberKey(task) {
    if (task.assigneeId)
        return `staff:${task.assigneeId}`;
    const name = task.assigneeName?.trim();
    if (name)
        return `name:${name}`;
    return UNASSIGNED_MEMBER_KEY;
}
export function resolveDateIssue(task) {
    const hasStart = isValidDateKey(task.startDate);
    const hasDue = isValidDateKey(task.dueDate);
    if (!hasStart && !hasDue)
        return 'missing-both';
    if (!hasStart)
        return 'missing-start';
    if (!hasDue)
        return 'missing-due';
    if (dateDiffInDays(task.startDate, task.dueDate) < 0)
        return 'reversed';
    return undefined;
}
/** 组内任务排序：开始日 → 截止日 → 项目 → ID，保证多次刷新顺序稳定。 */
function sortTasksForLayout(tasks) {
    return [...tasks].sort((left, right) => {
        const byStart = compareDateKeys(left.startDate, right.startDate);
        if (byStart !== 0)
            return byStart;
        const byDue = compareDateKeys(left.dueDate, right.dueDate);
        if (byDue !== 0)
            return byDue;
        if (left.projectId !== right.projectId)
            return left.projectId < right.projectId ? -1 : 1;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}
/** 按成员分组：优先配置顺序，否则按中文排序，未分配成员固定排最后。 */
export function groupTasksByMember(tasks, options = {}) {
    const groups = new Map();
    const keysOf = options.memberKeysOf ?? ((task) => [resolveMemberKey(task)]);
    const memberRanks = new Map(options.memberOrder?.map((key, index) => [key, index]));
    for (const task of tasks) {
        for (const key of keysOf(task)) {
            const existing = groups.get(key);
            if (existing) {
                existing.tasks.push(task);
                continue;
            }
            groups.set(key, {
                key,
                memberId: task.assigneeId ?? null,
                memberName: options.memberNames?.get(key) ?? task.assigneeName?.trim() ?? '',
                tasks: [task],
            });
        }
    }
    return [...groups.values()]
        .map((group) => ({
        ...group,
        memberName: group.memberName || UNASSIGNED_MEMBER_NAME,
        tasks: sortTasksForLayout(group.tasks),
    }))
        .sort((left, right) => {
        if (left.key === UNASSIGNED_MEMBER_KEY)
            return 1;
        if (right.key === UNASSIGNED_MEMBER_KEY)
            return -1;
        const leftRank = memberRanks.get(left.key) ?? Infinity;
        const rightRank = memberRanks.get(right.key) ?? Infinity;
        if (leftRank !== rightRank)
            return leftRank - rightRank;
        const byName = memberCollator.compare(left.memberName, right.memberName);
        if (byName !== 0)
            return byName;
        // 同名不同工号：用成员键兜底，保证顺序与数据到达顺序无关。
        return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    });
}
/** 唯一的几何数据来源：行高、纵坐标、任务条坐标都在这里一次算清。 */
export function computeLayout(input) {
    const config = { ...DEFAULT_LAYOUT_CONFIG, ...input.config };
    const collapsed = new Set(input.collapsedMemberKeys ?? []);
    const days = eachDateKey(input.range);
    const memberGroups = groupTasksByMember(input.tasks, {
        memberKeysOf: input.memberKeysOf,
        memberNames: input.memberNames,
        memberOrder: input.memberOrder,
    });
    const rows = [];
    const bars = [];
    const unscheduledTaskIds = [];
    let cursorY = 0;
    for (const group of memberGroups) {
        rows.push({
            type: 'member',
            key: `member:${group.key}`,
            memberKey: group.key,
            memberName: group.memberName,
            taskCount: group.tasks.length,
            y: cursorY,
            height: config.memberRowHeight,
        });
        cursorY += config.memberRowHeight;
        if (collapsed.has(group.key))
            continue;
        for (const task of group.tasks) {
            const rowY = cursorY;
            cursorY += config.taskRowHeight;
            rows.push({
                type: 'task',
                key: `task:${group.key}:${task.sourceType}:${task.id}`,
                taskId: `${task.sourceType}:${task.id}`,
                memberKey: group.key,
                title: task.title,
                y: rowY,
                height: config.taskRowHeight,
            });
            const issue = resolveDateIssue(task);
            if (issue) {
                unscheduledTaskIds.push(`${task.sourceType}:${task.id}`);
                continue;
            }
            const startDate = task.startDate;
            const dueDate = task.dueDate;
            const visibleStart = maxDateKey(startDate, input.range.start);
            const visibleDue = minDateKey(dueDate, input.range.end);
            const offsetDays = dateDiffInDays(input.range.start, visibleStart);
            const spanDays = dateDiffInDays(visibleStart, visibleDue) + 1;
            bars.push({
                key: `bar:${group.key}:${task.sourceType}:${task.id}`,
                taskId: `${task.sourceType}:${task.id}`,
                memberKey: group.key,
                title: task.title,
                projectId: task.projectId,
                color: task.projectColor,
                x: offsetDays * config.dayColumnWidth,
                y: rowY + (config.taskRowHeight - config.barHeight) / 2,
                width: spanDays * config.dayColumnWidth,
                height: config.barHeight,
                startDate,
                dueDate,
                clippedStart: dateDiffInDays(startDate, input.range.start) > 0,
                clippedEnd: dateDiffInDays(dueDate, input.range.end) < 0,
                completed: isCompletedStatus(task.status),
            });
        }
    }
    const today = input.today ?? todayKey();
    const todayOffset = dateDiffInDays(input.range.start, today);
    return {
        config,
        days,
        rows,
        bars,
        memberGroups,
        totalWidth: days.length * config.dayColumnWidth,
        totalHeight: cursorY,
        todayX: todayOffset >= 0 && todayOffset < days.length
            ? todayOffset * config.dayColumnWidth + config.dayColumnWidth / 2
            : null,
        unscheduledTaskIds,
    };
}
