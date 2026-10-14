import { describe, expect, it, vi } from 'vitest';

import {
  PAGE_SIZE,
  TapdApiError,
  TapdTruncationError,
  buildWindowQuery,
  fetchScheduleTasks,
  fetchWorkspaceItems,
  type TapdTransport,
} from './client';
import type { ProjectConfig } from '@/types/schedule';
import type { TapdEnvelope } from './types';

const RANGE = { start: '2026-10-01', end: '2026-10-31' };

const PROJECT: ProjectConfig = {
  id: '63253157',
  name: '中台项目',
  enabled: true,
  color: '#3b82f6',
};

function ok(data: unknown): TapdEnvelope<unknown> {
  return { status: 1, data, info: 'success' };
}

function taskRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    Task: {
      id: String(offset + index + 1),
      name: `任务 ${offset + index + 1}`,
      owner: '张三_800100001;',
      begin: '2026-10-01',
      due: '2026-10-02',
      status: 'open',
    },
  }));
}

describe('buildWindowQuery', () => {
  it('使用闭区间交叉命中窗口内与跨越窗口的任务', () => {
    const query = buildWindowQuery(RANGE);
    expect(query.begin).toBe('1970-01-01~2026-10-31');
    expect(query.due).toBe('2026-10-01~2999-12-31');
  });
});

describe('fetchWorkspaceItems 分页', () => {
  it('按 count 收敛并逐页拉取，不丢数据', async () => {
    const pages: string[] = [];
    const transport = vi.fn<TapdTransport>(async (path, params) => {
      if (path.endsWith('/count')) return ok({ count: 250 });
      pages.push(params.page);
      return ok(params.page === '1' ? taskRows(PAGE_SIZE) : taskRows(50, PAGE_SIZE));
    });

    const tasks = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT },
      transport
    );

    expect(tasks).toHaveLength(250);
    expect(pages).toEqual(['1', '2']);
  });

  it('返回不足一页时立即停止翻页', async () => {
    const transport = vi.fn<TapdTransport>(async (path) => {
      if (path.endsWith('/count')) return ok({ count: 9999 });
      return ok(taskRows(3));
    });

    const tasks = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT },
      transport
    );

    expect(tasks).toHaveLength(3);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('count 失败时仍能按页收敛拉取明细', async () => {
    const transport = vi.fn<TapdTransport>(async (path) => {
      if (path.endsWith('/count')) throw new Error('count 接口超时');
      return ok(taskRows(2));
    });

    const tasks = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT },
      transport
    );

    expect(tasks).toHaveLength(2);
  });

  it('缺陷走 /bugs 接口并按 title/current_owner 映射', async () => {
    const paths: string[] = [];
    const transport = vi.fn<TapdTransport>(async (path) => {
      paths.push(path);
      if (path.endsWith('/count')) return ok({ count: 1 });
      return ok([
        {
          Bug: {
            id: '7001',
            title: '列表分页异常',
            current_owner: '蔡宏炯_800170307',
            begin: '2026-10-05',
            due: '2026-10-05',
            status: 'closed',
          },
        },
      ]);
    });

    const tasks = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'bug', range: RANGE, project: PROJECT },
      transport
    );

    expect(paths).toEqual(['/bugs/count', '/bugs']);
    expect(tasks[0]).toMatchObject({ sourceType: 'bug', title: '列表分页异常', dueDate: '2026-10-05' });
  });
});

describe('错误处理', () => {
  it('TAPD status 非 1 时抛出可读错误', async () => {
    const transport: TapdTransport = async () => ({
      status: 401,
      data: '',
      info: '401 Unauthorized',
    });

    await expect(
      fetchWorkspaceItems(
        { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT },
        transport
      )
    ).rejects.toBeInstanceOf(TapdApiError);
  });

  it('网络错误重试一次后成功', async () => {
    let attempt = 0;
    const transport: TapdTransport = async (path) => {
      attempt += 1;
      if (attempt === 1) throw new Error('网络抖动');
      if (path.endsWith('/count')) return ok({ count: 1 });
      return ok(taskRows(1));
    };

    const tasks = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT },
      transport
    );

    expect(tasks).toHaveLength(1);
    expect(attempt).toBe(3);
  });
});

describe('fetchScheduleTasks', () => {
  it('单个项目失败不影响其它项目，并回报失败信息', async () => {
    const failing: ProjectConfig = {
      id: '62120799',
      name: '商城项目',
      enabled: true,
      color: '#10b981',
    };
    const disabled: ProjectConfig = { ...PROJECT, id: '99999999', enabled: false };

    const transport: TapdTransport = async (path, params) => {
      if (path === '/workspaces/users') return ok([]);
      if (params.workspace_id === failing.id) throw new Error('项目无权限');
      if (path.endsWith('/count')) return ok({ count: 1 });
      if (path === '/bugs') {
        return ok([
          { Bug: { id: '7001', title: '缺陷', current_owner: '张三_800100001', status: 'open' } },
        ]);
      }
      return ok(taskRows(1));
    };

    const result = await fetchScheduleTasks(
      { projects: [PROJECT, failing, disabled], range: RANGE, types: ['task', 'bug'] },
      transport
    );

    expect(result.tasks).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.workspaceId === failing.id)).toBe(true);
    expect(result.errors.every((error) => error.status === 0)).toBe(true);
    expect(result.tasks.some((task) => task.projectId === disabled.id)).toBe(false);
  });

  it('TAPD 错误响应保留状态码，便于界面区分凭据与权限问题', async () => {
    const transport: TapdTransport = async (path) => {
      if (path === '/workspaces/users') return ok([]);
      return { status: 403, data: '', info: 'Personal token company does not match workspace' };
    };

    const result = await fetchScheduleTasks(
      { projects: [PROJECT], range: RANGE, types: ['task'] },
      transport
    );

    expect(result.tasks).toHaveLength(0);
    expect(result.errors[0].status).toBe(403);
  });
});

function limitTransport(count: number | null): TapdTransport {
  return async (path, params) => {
    if (path === '/workspaces/users') return ok([]);
    if (path.endsWith('/count')) return count === null ? { status: 403, data: '', info: 'count不可用' } : ok({ count });
    return ok(taskRows(PAGE_SIZE, (Number(params.page) - 1) * PAGE_SIZE));
  };
}

describe('分页完整性', () => {
  it.each([10001, null])('超过安全上限或count不可用（%s）明确报截断并保留任务', async (count) => {
    const result = await fetchScheduleTasks(
      { projects: [PROJECT], range: RANGE, types: ['task'] }, limitTransport(count)
    );
    expect(result.tasks).toHaveLength(10000);
    expect(result.status).toBe('partial');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain('安全上限');
  });

  it('单独拉取触顶时抛出携带已拉取任务的错误', async () => {
    const error = await fetchWorkspaceItems(
      { workspaceId: PROJECT.id, type: 'task', range: RANGE, project: PROJECT }, limitTransport(10001)
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TapdTruncationError);
    expect((error as TapdTruncationError).tasks).toHaveLength(10000);
  });

  it('count确认刚好10000条时不误报截断', async () => {
    const result = await fetchScheduleTasks(
      { projects: [PROJECT], range: RANGE, types: ['task'] }, limitTransport(10000)
    );
    expect(result.tasks).toHaveLength(10000);
    expect(result.status).toBe('complete');
    expect(result.warnings).toEqual([]);
  });

  it('全部数据源失败时返回failed', async () => {
    const result = await fetchScheduleTasks(
      { projects: [PROJECT], range: RANGE, types: ['task', 'bug'] },
      async () => ({ status: 403, data: '', info: '无权限' })
    );
    expect(result.status).toBe('failed');
    expect(result.errors).toHaveLength(2);
  });

  it('一个数据源成功但没有任务时仍是部分成功', async () => {
    const result = await fetchScheduleTasks(
      { projects: [PROJECT], range: RANGE, types: ['task', 'bug'] },
      async (path) => path.startsWith('/bugs') ? { status: 403, data: '', info: '无权限' } : ok([])
    );
    expect(result.tasks).toEqual([]);
    expect(result.status).toBe('partial');
    expect(result.errors).toHaveLength(1);
  });
});

it('取消重试等待后不再发起请求',async()=>{const controller=new AbortController();const mock=vi.fn<TapdTransport>().mockRejectedValue(new Error('network'));const {requestWithRetry}=await import('./client');const request=requestWithRetry(mock,'/tasks',{},controller.signal);await Promise.resolve();await Promise.resolve();const failure=expect(request).rejects.toMatchObject({name:'AbortError'});controller.abort();await failure;expect(mock).toHaveBeenCalledOnce();});
