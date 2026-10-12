import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchScheduleTasksMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/tapd/client', () => ({ fetchScheduleTasks: fetchScheduleTasksMock }));

import { useSchedule } from './useSchedule';
import type { ProjectConfig, ScheduleTask } from '@/types/schedule';

const PROJECT: ProjectConfig = {
  id: '63253157',
  name: '巨像销售中台产品线',
  enabled: true,
  color: '#3b82f6',
};

const RANGE = { start: '2026-10-01', end: '2026-10-31' };

function task(id: string): ScheduleTask {
  return {
    id,
    sourceType: 'task',
    title: `任务 ${id}`,
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    projectColor: PROJECT.color,
    assigneeId: null,
    assigneeName: '',
    assigneeIds: [],
    startDate: '2026-10-01',
    dueDate: '2026-10-02',
    status: 'open',
    tapdUrl: 'https://www.tapd.cn/tapd_fe/63253157/task/detail/1',
  };
}

afterEach(() => {
  fetchScheduleTasksMock.mockReset();
});

describe('useSchedule', () => {
  it('加载成功后写入任务、失败项目与刷新时间', async () => {
    fetchScheduleTasksMock.mockResolvedValueOnce({
      warnings: [],
      status: 'partial',
      tasks: [task('1')],
      errors: [{ workspaceId: '62120799', type: 'bug', status: 403, message: '无权限' }],
    });

    const schedule = useSchedule();
    await schedule.refresh([PROJECT], RANGE);

    expect(schedule.liveTasks.value).toHaveLength(1);
    expect(schedule.errors.value).toHaveLength(1);
    expect(schedule.lastLoadedAt.value).toBeTruthy();
    expect(schedule.loading.value).toBe(false);
  });

  it('整体加载异常不再静默：写入 errors 供界面提示', async () => {
    fetchScheduleTasksMock.mockRejectedValueOnce(new Error('网络中断'));

    const schedule = useSchedule();
    await schedule.refresh([PROJECT], RANGE);

    expect(schedule.errors.value).toHaveLength(1);
    expect(schedule.errors.value[0].message).toContain('网络中断');
    expect(schedule.errors.value[0].workspaceId).toBe('(整体加载)');
    expect(schedule.loading.value).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const success = (id: string) => ({ tasks: [task(id)], errors: [], warnings: [], status: 'complete' as const });

describe('刷新一致性', () => {
  it('旧请求先结束时不结束最新请求的加载状态', async () => {
    const old = deferred<ReturnType<typeof success>>();
    const latest = deferred<ReturnType<typeof success>>();
    fetchScheduleTasksMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const schedule = useSchedule();
    const first = schedule.refresh([PROJECT], RANGE);
    const nextRange = { start: '2026-11-01', end: '2026-11-30' };
    const second = schedule.refresh([PROJECT], nextRange);
    old.resolve(success('old'));
    await first;
    expect(schedule.loading.value).toBe(true);
    expect(schedule.liveTasks.value).toEqual([]);
    expect(schedule.lastLoadedAt.value).toBeNull();
    latest.resolve(success('new'));
    await second;
    expect(schedule.loading.value).toBe(false);
    expect(schedule.loadedRange.value).toEqual(nextRange);
  });

  it.each(['success', 'failure'])('最新请求完成后忽略旧请求的%s', async (outcome) => {
    const old = deferred<ReturnType<typeof success>>();
    fetchScheduleTasksMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success('new'));
    const schedule = useSchedule();
    const first = schedule.refresh([PROJECT], RANGE);
    await schedule.refresh([PROJECT], RANGE);
    const timestamp = schedule.lastLoadedAt.value;
    if (outcome === 'success') old.resolve(success('old'));
    else old.reject(new Error('旧请求失败'));
    await first;
    expect(schedule.liveTasks.value[0].id).toBe('new');
    expect(schedule.errors.value).toEqual([]);
    expect(schedule.lastLoadedAt.value).toBe(timestamp);
    expect(schedule.loadStatus.value).toBe('complete');
  });

  it.each(['result', 'exception'])('全部失败（%s）保留上次成功数据、时间和范围', async (outcome) => {
    fetchScheduleTasksMock.mockResolvedValueOnce(success('previous'));
    const schedule = useSchedule();
    await schedule.refresh([PROJECT], RANGE);
    const timestamp = schedule.lastLoadedAt.value;
    if (outcome === 'result') fetchScheduleTasksMock.mockResolvedValueOnce({
      tasks: [], warnings: [], status: 'failed',
      errors: [{ workspaceId: PROJECT.id, type: 'task', status: 403, message: '无权限' }],
    });
    else fetchScheduleTasksMock.mockRejectedValueOnce(new Error('网络中断'));
    await schedule.refresh([PROJECT], { start: '2026-11-01', end: '2026-11-30' });
    expect(schedule.liveTasks.value[0].id).toBe('previous');
    expect(schedule.lastLoadedAt.value).toBe(timestamp);
    expect(schedule.loadedRange.value).toEqual(RANGE);
    expect(schedule.loadStatus.value).toBe('failed');
  });

  it('成功空数据更新范围与刷新时间，和失败区分', async () => {
    fetchScheduleTasksMock.mockResolvedValueOnce({ tasks: [], errors: [], warnings: [], status: 'complete' });
    const schedule = useSchedule();
    await schedule.refresh([PROJECT], RANGE);
    expect(schedule.loadStatus.value).toBe('complete');
    expect(schedule.loadedRange.value).toEqual(RANGE);
    expect(schedule.lastLoadedAt.value).not.toBeNull();
  });
});
