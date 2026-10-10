import type { ScheduleTask } from '@/types/schedule';
import type { MemberEntry } from '@/types/settings';

export interface ResolvedMember {
  key: string;
  staffId: string;
  name: string;
}

export function memberKeyOf(staffId: string): string {
  return `staff:${staffId}`;
}

/**
 * 任务归属的成员：取「任务负责人」与「配置成员名单」的交集。
 * 空交集（含无负责人的任务）表示该任务不展示。
 */
export function resolveTaskMembers(
  task: ScheduleTask,
  members: readonly MemberEntry[]
): ResolvedMember[] {
  if (members.length === 0) return [];

  const byStaffId = new Map(members.map((member) => [member.staffId, member]));
  const resolved: ResolvedMember[] = [];
  for (const staffId of task.assigneeIds) {
    const member = byStaffId.get(staffId);
    if (member) {
      resolved.push({ key: memberKeyOf(member.staffId), staffId: member.staffId, name: member.name });
    }
  }
  return resolved;
}

export interface MemberExpansionResult {
  /** 成员键 -> 该成员下的任务（保持输入顺序）。 */
  tasksByMember: Map<string, ScheduleTask[]>;
  /** 成员键 -> 展示名。 */
  namesByMember: Map<string, string>;
  /** 因未命中配置成员而未展示的任务数。 */
  hiddenTaskCount: number;
}

/** 按配置成员展开任务：命中多个成员的任务会出现在多个成员分组下（每个分组各占一行）。 */
export function expandTasksByMember(
  tasks: readonly ScheduleTask[],
  members: readonly MemberEntry[]
): MemberExpansionResult {
  const tasksByMember = new Map<string, ScheduleTask[]>();
  const namesByMember = new Map<string, string>();
  let hiddenTaskCount = 0;

  for (const task of tasks) {
    const resolved = resolveTaskMembers(task, members);
    if (resolved.length === 0) {
      hiddenTaskCount += 1;
      continue;
    }
    for (const member of resolved) {
      namesByMember.set(member.key, member.name);
      const bucket = tasksByMember.get(member.key);
      if (bucket) bucket.push(task);
      else tasksByMember.set(member.key, [task]);
    }
  }

  return { tasksByMember, namesByMember, hiddenTaskCount };
}

/** PoC mock 模式用：从任务自身推导成员名单，避免依赖配置。 */
export function membersFromTasks(tasks: readonly ScheduleTask[]): MemberEntry[] {
  const members = new Map<string, MemberEntry>();
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    if (!members.has(task.assigneeId)) {
      members.set(task.assigneeId, {
        staffId: task.assigneeId,
        name: task.assigneeName || task.assigneeId,
      });
    }
  }
  return [...members.values()];
}

/** 按筛选结果取成员子集；`null` 表示全选。 */
export function selectMembersByKeys(
  members: readonly MemberEntry[],
  memberKeys: string[] | null
): MemberEntry[] {
  if (memberKeys === null) return [...members];
  const selected = new Set(memberKeys);
  return members.filter((member) => selected.has(memberKeyOf(member.staffId)));
}

export interface MemberResolution {
  memberKeysOf: (task: ScheduleTask) => string[];
  memberNames: Map<string, string>;
  hiddenTaskCount: number;
}

/** 统一构造布局需要的成员解析函数，避免页面与组件各自拼装。 */
export function createMemberResolution(
  tasks: readonly ScheduleTask[],
  members: readonly MemberEntry[]
): MemberResolution {
  const expansion = expandTasksByMember(tasks, members);
  const names = new Map(members.map((member) => [memberKeyOf(member.staffId), member.name]));

  return {
    memberKeysOf: (task) => resolveTaskMembers(task, members).map((member) => member.key),
    memberNames: names,
    hiddenTaskCount: expansion.hiddenTaskCount,
  };
}
