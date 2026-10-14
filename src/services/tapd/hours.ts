import type { HoursCache, HoursPageResult } from './hoursCache';
import type { DateRange } from '@/gantt/dateUtils';
import type { HoursIssue, HoursSettings, HoursSnapshot, TimesheetRecord } from '@/types/hours';
import type { MemberEntry } from '@/types/settings';
import type { ProjectConfig, ScheduleTask, WorkItemType } from '@/types/schedule';
import { hoursTaskKey, parseHours } from '@/hours/statistics';
import { isHoursCompleted } from '@/hours/settings';
import { PAGE_SIZE, requestWithRetry, runWithConcurrency, tauriTransport, type TapdTransport } from './client';
import { fieldsFor, mapRow, normalizeDateKey, parseAssignees } from './mapper';
import type { RawRow } from './types';

const MAX_PAGES = 50;
const TIMESHEET_FIELDS = 'id,workspace_id,entity_type,entity_id,owner,spentdate,timespent,is_delete';
type PageResult = HoursPageResult;

async function fetchPages(path: string, params: Record<string, string>, key: string, transport: TapdTransport, signal?: AbortSignal): Promise<PageResult> {
  let expected = Infinity;
  const rows: RawRow[] = [];
  const seenIds = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      signal?.throwIfAborted();
      const result = await requestWithRetry(transport, path, { ...params, limit: String(PAGE_SIZE), page: String(page), order: 'id asc' }, signal);
      if (!Array.isArray(result.data)) throw new Error('列表响应格式无效');
      const entries = result.data.map(item => (item as Record<string, unknown>)?.[key]);
      if (entries.some(item => !item || typeof item !== 'object')) throw new Error('列表含有无法识别的记录');
      if (entries.some(item => seenIds.has(String((item as RawRow)[key === 'UserWorkspace' ? 'user' : 'id'])))) throw new Error('分页返回重复记录，无法确认数据完整性');
      entries.forEach(item => seenIds.add(String((item as RawRow)[key === 'UserWorkspace' ? 'user' : 'id'])));
      rows.push(...entries as RawRow[]);
      // 首页面不足 200 条就已收敛，避免每个任务累计查询额外请求 count。
      if (entries.length === PAGE_SIZE && page === 1) {
        try {
          const countResult = await requestWithRetry(transport, path + '/count', params, signal);
          const count = Number((countResult.data as { count?: unknown })?.count);
          if (Number.isFinite(count) && count >= rows.length) expected = count;
        } catch { /* count 不可用时按短页收敛。 */ }
      }
      if (entries.length < PAGE_SIZE || page * PAGE_SIZE >= expected) return { rows, complete: true, fetchedAt: Date.now() };
    } catch (error) {
      signal?.throwIfAborted();
      return { rows, complete: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { rows, complete: false, error: '达到 50 页安全上限，数据不完整' };
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
  cache?: HoursCache;
  force?: boolean;
  onProgress?: (progress: { stage: string; completed: number; total: number }) => void;
}
/** 按已配置成员查询工作项，完整覆盖跨窗、缺日期、逾期任务，不扫描项目全量工作项。 */
export async function fetchHoursSnapshot(query: HoursQuery, transport: TapdTransport = tauriTransport, options: HoursLoadOptions = {}): Promise<HoursSnapshot> {
  const { signal, cache } = options;
  const started = performance.now();
  let requests = 0, cacheHits = 0;
  let fetchedAt = Infinity;
  const context = JSON.stringify({ projects: query.projects.filter(p => p.enabled).map(p => [p.id, p.name]).sort(), members: query.members.map(m => [m.staffId, m.name]).sort(), today: query.today, credentialRevision: query.credentialRevision ?? 0 }) + '|';
  if (options.force) cache?.clear(context);
  const underlying = transport;
  transport = async (path, params) => { signal?.throwIfAborted(); requests++; return underlying(path, params, signal); };
  async function pages(path: string, params: Record<string, string>, key: string): Promise<PageResult> {
    signal?.throwIfAborted();
    const cacheKey = context + path + JSON.stringify(Object.entries(params).sort());
    let result = cache?.get(cacheKey);
    if (result) cacheHits++;
    else { result = await fetchPages(path, params, key, transport, signal); signal?.throwIfAborted(); cache?.set(cacheKey, result); }
    fetchedAt = Math.min(fetchedAt, result.fetchedAt ?? Date.now());
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
      directories.set(project.id, new Map(users.flatMap(user => {
        const id = parseAssignees(user.user)[0]?.id;
        return id ? [[id, String(user.user)] as [string, string]] : [];
      })));
      knownUsers.set(project.id, new Set(users.map(user => String(user.user))));
    } catch (error) {
      signal?.throwIfAborted();
      issues.push({ projectId: project.id, affects: 'forecast', message: project.name + '：成员目录加载失败，无法确认任务归属：' + String(error) });
    } finally { directoryDone(); }
  });

  function collectTimesheets(result: PageResult, project: ProjectConfig, affects: HoursIssue['affects'], taskKey?: string): void {
    if (result.complete) successfulSources++;
    else issues.push({ projectId: project.id, affects, taskKey, message: project.name + '：工时记录不完整：' + result.error });
    for (const row of result.rows) {
      if (!['task', 'bug'].includes(String(row.entity_type)) || Number(row.is_delete) === 1) continue;
      const date = normalizeDateKey(row.spentdate);
      const hours = parseHours(row.timespent);
      const owner = String(row.owner ?? '').trim();
      const id = row.id == null ? '' : String(row.id);
      const entityId = row.entity_id == null ? '' : String(row.entity_id);
      if (taskKey && [project.id, row.entity_type, entityId].join(':') !== taskKey) {
        issues.push({ projectId: project.id, affects, taskKey, message: project.name + '：工时关联工作项筛选不匹配' });
        continue;
      }
      const staffId = parseAssignees(owner)[0]?.id;
      const invalidOwner = !staffId && !knownUsers.get(project.id)?.has(owner);
      if (!date || hours === null || !owner || !id || !entityId || invalidOwner) {
        issues.push({ projectId: project.id, affects, taskKey, date: date ?? undefined, staffId: staffId ?? undefined, message: project.name + '：存在无法解析日期、工时或填报人的记录' });
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
    else issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: project.name + '：成员工作项不完整：' + result.error });
    taskDone();
    for (const row of result.rows) {
      const task = mapRow(row, project, type);
      if (!task) {
        issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: project.name + '：存在缺少 ID 的工作项' });
      } else if (task.assigneeIds.includes(member.staffId)) {
        tasks.set(hoursTaskKey(task), task);
        if (parseAssignees(type === 'task' ? row.owner : row.current_owner).some(owner => !owner.id)) {
          issues.push({ projectId: project.id, affects: 'forecast', taskKey: hoursTaskKey(task), message: project.name + '：多人工作项存在无法识别工号的负责人，份额待确认' });
        }
      } else {
        issues.push({ projectId: project.id, staffId: member.staffId, affects: 'forecast', message: project.name + '：工作项负责人筛选或身份解析不匹配' });
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
