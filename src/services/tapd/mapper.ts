import { isValidDateKey } from '@/gantt/dateUtils';
import type { MemberDirectory, ProjectConfig, ScheduleTask, WorkItemType } from '@/types/schedule';
import type { RawRow } from './types';

/** TAPD 列表接口返回的字段集合（按已验证字段裁剪，避免拉取几百个自定义字段）。 */
const TASK_FIELDS = [
  'id',
  'name',
  'workspace_id',
  'owner',
  'creator',
  'status',
  'priority_label',
  'effort',
  'begin',
  'due',
  'iteration_id',
  'created',
  'modified',
  'completed',
].join(',');

const BUG_FIELDS = [
  'id',
  'title',
  'workspace_id',
  'current_owner',
  'creator',
  'status',
  'priority_label',
  'effort',
  'begin',
  'due',
  'iteration_id',
  'created',
  'modified',
  'closed',
].join(',');

export function fieldsFor(type: WorkItemType): string {
  return type === 'task' ? TASK_FIELDS : BUG_FIELDS;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 规范化 TAPD 日期字段为 `YYYY-MM-DD`。
 * 只接受日期或日期时间前缀，无法识别时返回 null，绝不推算。
 */
export function normalizeDateKey(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const candidate = raw.slice(0, 10);
  return isValidDateKey(candidate) ? candidate : null;
}

interface ParsedAssignee {
  id: string | null;
  name: string;
}

/** 解析全部负责人：task 为 `姓名_工号;` 分号分隔多人，bug 通常只有一个。 */
export function parseAssignees(value: unknown): ParsedAssignee[] {
  const raw = asString(value);
  if (!raw) return [];

  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const matched = /^(.*)_(\d+)$/.exec(part);
      if (!matched) return { id: null, name: part };
      return { id: matched[2], name: matched[1].trim() };
    });
}

/**
 * TAPD 详情页地址。
 * 已验证形态（HTTP 200，无需登录即可命中前端路由）：
 *   https://www.tapd.cn/tapd_fe/<workspace_id>/task/detail/<id>
 *   https://www.tapd.cn/tapd_fe/<workspace_id>/bug/detail/<id>
 * 旧形态 `/<workspace_id>/<task|bug>/view/<id>` 只会 302 跳登录，不要使用。
 */
export function buildTapdUrl(workspaceId: string, type: WorkItemType, id: string): string {
  const view = type === 'task' ? 'task' : 'bug';
  return `https://www.tapd.cn/tapd_fe/${workspaceId}/${view}/detail/${id}`;
}

export function mapRow(
  row: RawRow,
  project: ProjectConfig,
  type: WorkItemType,
  members: MemberDirectory = {}
): ScheduleTask | null {
  const id = asString(row.id);
  if (!id) return null;

  const title = type === 'task' ? asString(row.name) : asString(row.title);
  const assignees = parseAssignees(type === 'task' ? row.owner : row.current_owner);
  const primary = assignees[0] ?? { id: null, name: '' };
  const assigneeIds = [
    ...new Set(assignees.map((item) => item.id).filter((id): id is string => Boolean(id))),
  ];
  const directoryName = primary.id ? members[primary.id] : undefined;

  return {
    id,
    sourceType: type,
    title: title || '(无标题)',
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    assigneeId: primary.id,
    assigneeName: directoryName ?? primary.name,
    assigneeIds,
    startDate: normalizeDateKey(row.begin),
    dueDate: normalizeDateKey(row.due),
    status: asString(row.status),
    priority: asString(row.priority_label) || undefined,
    effort: asString(row.effort) || undefined,
    tapdUrl: buildTapdUrl(project.id, type, id),
    rawStatus: asString(row.status),
  };
}

/** 去重键：同类工作项 ID + 来源类型，避免跨类型重号。 */
function taskKey(task: Pick<ScheduleTask, 'id' | 'sourceType'>): string {
  return `${task.sourceType}:${task.id}`;
}

export function dedupeTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  const seen = new Set<string>();
  const result: ScheduleTask[] = [];
  for (const task of tasks) {
    const key = taskKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(task);
  }
  return result;
}

/** 解析 `/workspaces/users` 返回，建立 工号 -> 姓名 索引。 */
export function mapWorkspaceUsers(rows: RawRow[]): MemberDirectory {
  const directory: MemberDirectory = {};
  for (const row of rows) {
    const user = asString(row.user);
    const name = asString(row.name);
    const matched = /^(.*)_(\d+)$/.exec(user);
    if (matched) {
      directory[matched[2]] = name || matched[1];
      continue;
    }
    if (user) directory[user] = name || user;
  }
  return directory;
}
