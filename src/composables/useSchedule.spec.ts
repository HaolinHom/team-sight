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
