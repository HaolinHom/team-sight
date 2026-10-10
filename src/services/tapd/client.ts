import type { DateRange } from '@/gantt/dateUtils';
import type { MemberDirectory, ProjectConfig, ScheduleTask, WorkItemType } from '@/types/schedule';
import { dedupeTasks, fieldsFor, mapRow, mapWorkspaceUsers } from './mapper';
import type { RawRow, ScheduleFetchResult, TapdEnvelope, WorkspaceFetchError } from './types';

/** TAPD 单页上限（官方文档：limit 默认 30，最大 200）。 */
export const PAGE_SIZE = 200;
const MAX_PAGES = 50;
/** 并发上限：避免一次刷新打满 TAPD 限流。 */
const MAX_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [300, 900];
/**
 * 时间窗固定下限/上限。
 * TAPD 时间查询只支持闭区间，开区间（`~date` / `date~`）会被静默忽略并返回全量，
 * 因此用「begin 落在 [下限, 窗口结束]」且「due 落在 [窗口开始, 上限]」交叉命中跨越窗口的任务。
 */
const WINDOW_FLOOR = '1970-01-01';
const WINDOW_CEIL = '2999-12-31';

export class TapdApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TapdApiError';
    this.status = status;
  }
}

export interface TapdRequestOptions {
  workspaceId: string;
  type: WorkItemType;
  range: DateRange;
}

export type TapdTransport = (
  path: string,
  params: Record<string, string>
) => Promise<TapdEnvelope<unknown>>;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 默认传输层：通过 Tauri 命令发请求。
 * 令牌只在 Rust 进程内使用，不进入前端打包产物。
 */
export const tauriTransport: TapdTransport = async (path, params) => {
  if (!isTauriRuntime()) {
    throw new TapdApiError('当前不在 Tauri 运行环境中，无法访问 TAPD 接口', 0);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const body = await invoke<string>('tapd_get', {
    path,
    params: Object.entries(params),
  });
  return JSON.parse(body) as TapdEnvelope<unknown>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestWithRetry(
  transport: TapdTransport,
  path: string,
  params: Record<string, string>
): Promise<TapdEnvelope<unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const envelope = await transport(path, params);
      if (envelope.status !== 1) {
        throw new TapdApiError(`TAPD 返回错误：${envelope.info || '未知错误'}`, envelope.status);
      }
      return envelope;
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof TapdApiError) || error.status >= 500;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function endpointFor(type: WorkItemType): string {
  return type === 'task' ? '/tasks' : '/bugs';
}

export function buildWindowQuery(range: DateRange): Record<string, string> {
  return {
    begin: `${WINDOW_FLOOR}~${range.end}`,
    due: `${range.start}~${WINDOW_CEIL}`,
  };
}

function rowsOf(envelope: TapdEnvelope<unknown>, type: WorkItemType): RawRow[] {
  const data = envelope.data;
  if (!Array.isArray(data)) return [];
  const key = type === 'task' ? 'Task' : 'Bug';
  return data
    .map((entry) => (entry as Record<string, unknown>)?.[key])
    .filter((row): row is RawRow => typeof row === 'object' && row !== null);
}

function countOf(envelope: TapdEnvelope<unknown>): number {
  const data = envelope.data;
  if (data && typeof data === 'object' && 'count' in data) {
    const count = Number((data as { count: unknown }).count);
    if (Number.isFinite(count)) return count;
  }
  return 0;
}

/** 查询时间窗内命中的条数（用于分页收敛判断）。 */
async function fetchWorkspaceItemCount(
  options: TapdRequestOptions,
  transport: TapdTransport = tauriTransport
): Promise<number> {
  const envelope = await requestWithRetry(transport, `${endpointFor(options.type)}/count`, {
    workspace_id: options.workspaceId,
    ...buildWindowQuery(options.range),
  });
  return countOf(envelope);
}

/** 拉取单个项目 + 单个工作项类型的全部任务（自动翻页）。 */
export async function fetchWorkspaceItems(
  options: TapdRequestOptions & { project: ProjectConfig; members?: MemberDirectory },
  transport: TapdTransport = tauriTransport
): Promise<ScheduleTask[]> {
  const { workspaceId, type, range, project, members = {} } = options;
  const endpoint = endpointFor(type);
  const baseParams = {
    workspace_id: workspaceId,
    ...buildWindowQuery(range),
    fields: fieldsFor(type),
  };

  let expected = Number.POSITIVE_INFINITY;
  try {
    expected = await fetchWorkspaceItemCount({ workspaceId, type, range }, transport);
  } catch {
    // count 失败不阻塞明细拉取：按页收敛条件退出。
    expected = Number.POSITIVE_INFINITY;
  }

  const collected: ScheduleTask[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const envelope = await requestWithRetry(transport, endpoint, {
      ...baseParams,
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    const rows = rowsOf(envelope, type);
    for (const row of rows) {
      const mapped = mapRow(row, project, type, members);
      if (mapped) collected.push(mapped);
    }
    if (rows.length < PAGE_SIZE) break;
    if (collected.length >= expected) break;
  }

  return collected;
}

/** 项目成员表：工号 -> 姓名，用于把负责人字段归一为展示名。 */
export async function fetchWorkspaceUsers(
  workspaceId: string,
  transport: TapdTransport = tauriTransport
): Promise<MemberDirectory> {
  const envelope = await requestWithRetry(transport, '/workspaces/users', {
    workspace_id: workspaceId,
    limit: String(PAGE_SIZE),
  });
  const data = envelope.data;
  const rows = Array.isArray(data)
    ? data
        .map((entry) => (entry as Record<string, unknown>)?.['UserWorkspace'])
        .filter((row): row is RawRow => typeof row === 'object' && row !== null)
    : [];
  return mapWorkspaceUsers(rows);
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return results;
}

export interface ScheduleQuery {
  projects: ProjectConfig[];
  range: DateRange;
  types: WorkItemType[];
}

/**
 * 聚合多个项目 + 多个工作项类型。
 * 单个项目失败不影响其它项目，失败信息随结果一起返回。
 */
export async function fetchScheduleTasks(
  query: ScheduleQuery,
  transport: TapdTransport = tauriTransport
): Promise<ScheduleFetchResult> {
  const jobs: Array<{ project: ProjectConfig; type: WorkItemType }> = [];
  for (const project of query.projects.filter((item) => item.enabled)) {
    for (const type of query.types) jobs.push({ project, type });
  }

  const memberDirectories = new Map<string, MemberDirectory>();
  await runWithConcurrency(
    [...new Set(query.projects.filter((project) => project.enabled).map((project) => project.id))],
    MAX_CONCURRENCY,
    async (workspaceId) => {
      try {
        memberDirectories.set(workspaceId, await fetchWorkspaceUsers(workspaceId, transport));
      } catch {
        memberDirectories.set(workspaceId, {});
      }
    }
  );

  const errors: WorkspaceFetchError[] = [];
  const results = await runWithConcurrency(jobs, MAX_CONCURRENCY, async (job) => {
    try {
      return await fetchWorkspaceItems(
        {
          workspaceId: job.project.id,
          type: job.type,
          range: query.range,
          project: job.project,
          members: memberDirectories.get(job.project.id) ?? {},
        },
        transport
      );
    } catch (error) {
      errors.push({
        workspaceId: job.project.id,
        type: job.type,
        status: error instanceof TapdApiError ? error.status : 0,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });

  return { tasks: dedupeTasks(results.flat()), errors };
}
