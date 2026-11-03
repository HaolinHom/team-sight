import type { DateRange, HoursIssue, HoursSettings, HoursSnapshot, TimesheetRecord, MemberEntry, ProjectConfig, ScheduleTask, WorkItemType, RawRow } from '@teamsight/core';
import { hoursTaskKey, parseHours, isHoursCompleted, mapScheduleRow as mapRow, normalizeDateKey, parseAssignees } from '@teamsight/core';
import { TapdClient } from './client.js';
import { fieldsFor } from './mapper.js';
import type { PageResult } from './types.js';
const TIMESHEET_FIELDS = 'id,workspace_id,entity_type,entity_id,owner,spentdate,timespent,is_delete';
async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await fn(items[cursor++]);
  }));
}

export interface HoursQuery {
  projects: readonly ProjectConfig[];
  members: readonly MemberEntry[];
  range: DateRange;
  today: string;
  settings: HoursSettings;
  credentialRevision?: number;
}

export interface HoursLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { stage: string; completed: number; total: number }) => void;
}
/** 按已配置成员查询工作项，完整覆盖跨窗、缺日期、逾期任务，不扫描项目全量工作项。 */
export async function fetchHoursSnapshot(query: HoursQuery, client: TapdClient, options: HoursLoadOptions = {}): Promise<HoursSnapshot> {
  const { signal } = options;
  const started = performance.now();
  let requests = 0, cacheHits = 0;
  let fetchedAt = Infinity;
  async function pages(path: '/tasks' | '/bugs' | '/timesheets' | '/workspaces/users', params: Record<string, string>, key: string): Promise<PageResult> {
    requests++;
    const result = await client.pages(path, params, key, signal);
    fetchedAt = Math.min(fetchedAt, result.fetchedAt);
    return result;
  }
  let completed = 0;
  function stage(name: string, total: number): () => void {
    completed = 0;
    options.onProgress?.({ stage: name, completed, total });
    return () => options.onProgress?.({ stage: name, completed: ++completed, total });
  }
  const projects = query.projects.filter(project => project.enabled);
  const tasks = new Map<string, ScheduleTask>();
  const records = new Map<string, TimesheetRecord>();
  const issues: HoursIssue[] = [];
  const directories = new Map<string, Map<string, string>>();
  const knownUsers = new Map<string, Set<string>>();
  let successfulSources = 0;
  const directoryDone = stage('读取成员目录', projects.length);
  await runWithConcurrency(projects, 3, async project => {
    try {
      const result = await pages('/workspaces/users', { workspace_id: project.id }, 'UserWorkspace');
      if (!result.complete) throw new Error(result.error);
      const users = result.rows;
      const ids = users.map(user => parseAssignees(user.user)[0]?.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) throw new Error('AMBIGUOUS_MEMBER_DIRECTORY');
      directories.set(project.id, new Map(users.flatMap(user => {
        const id = parseAssignees(user.user)[0]?.id;
        return id ? [[id, String(user.user)] as [string, string]] : [];
      })));
      knownUsers.set(project.id, new Set(users.map(user => String(user.user))));
    } catch (error) {
      signal?.throwIfAborted();
      issues.push({ projectId: project.id, affects: 'forecast', message: '成员目录加载失败，无法确认任务归属：' + String(error) });
    } finally { directoryDone(); }
  });

  function collectTimesheets(result: PageResult, project: ProjectConfig, affects: HoursIssue['affects'], taskKey?: string): void {
    if (result.complete) successfulSources++;
    else issues.push({ projectId: project.id, affects, taskKey, message: '工时记录不完整：' + result.error });
    for (const row of result.rows) {
      if (!['task', 'bug'].includes(String(row.entity_type)) || Number(row.is_delete) === 1) continue;
      const date = normalizeDateKey(row.spentdate);
      const hours = parseHours(row.timespent);
      const owner = String(row.owner ?? '').trim();
      const id = row.id == null ? '' : String(row.id);
      const entityId = row.entity_id == null ? '' : String(row.entity_id);
      if (taskKey && [project.id, row.entity_type, entityId].join(':') !== taskKey) {
        issues.push({ projectId: project.id, affects, taskKey, message: '工时关联工作项筛选不匹配' });
        continue;
      }
      const staffId = parseAssignees(owner)[0]?.id;
      const invalidOwner = !staffId && !knownUsers.get(project.id)?.has(owner);
      if (!date || hours === null || !owner || !id || !entityId || invalidOwner) {
        issues.push({ projectId: project.id, affects, taskKey, date: date ?? undefined, staffId: staffId ?? undefined, message: '存在无法解析日期、工时或填报人的记录' });
        continue;
      }
      // 目录中无工号的账号无法被配置为展示成员；仍保留其花费以扣减任务总剩余量。
      const record: TimesheetRecord = { id, projectId: project.id, entityType: row.entity_type as WorkItemType, entityId, staffId: staffId ?? 'user:' + owner, spentDate: date, hours };
      records.set(project.id + ':' + id, record);
    }
  }

  if (query.range.start <= query.today) {
    const actualDone = stage('读取每日实际工时', projects.length);
    await runWithConcurrency(projects, 3, async project => {
      const result = await pages('/timesheets', { workspace_id: project.id, spentdate: query.range.start + '~' + (query.range.end < query.today ? query.range.end : query.today), is_delete: '0', include_parent_story_timesheet: '0', fields: TIMESHEET_FIELDS }, 'Timesheet');
      collectTimesheets(result, project, 'actual');
      actualDone();
    });
  }

  const jobs = projects.flatMap(project => query.members.flatMap(member => {
    const user = directories.get(project.id)?.get(member.staffId);
    return user ? (['task', 'bug'] as WorkItemType[]).map(type => ({ project, member, user, type })) : [];
  }));
  const taskDone = stage('读取成员工作项', jobs.length);
  await runWithConcurrency(jobs, 3, async ({ project, member, user, type }) => {
    const result = await pages(type === 'task' ? '/tasks' : '/bugs', { workspace_id: project.id, [type === 'task' ? 'owner' : 'current_owner']: user, fields: fieldsFor(type) }, type === 'task' ? 'Task' : 'Bug');
    if (result.complete) successfulSources++;
    else issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: '成员工作项不完整：' + result.error });
    taskDone();
    for (const row of result.rows) {
      const task = mapRow(row, project, type);
      if (!task) {
        issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: '存在缺少 ID 的工作项' });
      } else if (task.assigneeIds.includes(member.staffId)) {
        tasks.set(hoursTaskKey(task), task);
        if (parseAssignees(type === 'task' ? row.owner : row.current_owner).some(owner => !owner.id)) {
          issues.push({ projectId: project.id, affects: 'forecast', taskKey: hoursTaskKey(task), message: '多人工作项存在无法识别工号的负责人，份额待确认' });
        }
      } else {
        issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: '工作项负责人筛选或身份解析不匹配' });
      }
    }
  });

  // 每个未结束工作项单独读取完整累计花费。不能只减当前月，也不能按当前负责人过滤。
  const unfinished = [...tasks.values()].filter(task => !isHoursCompleted(task, query.settings));
  const cumulativeDone = stage('读取累计工时', unfinished.length);
  await runWithConcurrency(unfinished, 3, async task => {
    const project = projects.find(project => project.id === task.projectId)!;
    const result = await pages('/timesheets', { workspace_id: project.id, entity_type: task.sourceType, entity_id: task.id, spentdate: '1970-01-01~' + query.today, is_delete: '0', include_parent_story_timesheet: '0', fields: TIMESHEET_FIELDS }, 'Timesheet');
    collectTimesheets(result, project, 'forecast', hoursTaskKey(task));
    cumulativeDone();
  });
  signal?.throwIfAborted();
  return { fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(), metrics: { requests, cacheHits, fetchMs: performance.now() - started }, tasks: [...tasks.values()], records: [...records.values()], issues, status: issues.length ? successfulSources ? 'partial' : 'failed' : 'complete' };
}
