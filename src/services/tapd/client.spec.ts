import { describe, expect, it, vi } from 'vitest';

import {
  PAGE_SIZE,
  TapdApiError,
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
    expect(result.tasks.some((task) => task.projectId === disabled.id)).toBe(false);
  });
});
