import { describe, expect, it } from 'vitest';

import {
  LARGE_RANGE_DAYS,
  MAX_RANGE_DAYS,
  collectStatusOptions,
  createDefaultFilters,
  filterTasks,
  isCompletedStatus,
  statusKey,
  validateRange,
} from './filters';
import type { ScheduleTask } from '@/types/schedule';

function task(partial: Partial<ScheduleTask> & Pick<ScheduleTask, 'id'>): ScheduleTask {
  return {
    sourceType: 'task',
    title: `任务 ${partial.id}`,
    projectId: 'P1',
    projectName: '项目一',
    projectColor: '#3b82f6',
    assigneeId: null,
    assigneeName: '',
    assigneeIds: [],
    startDate: '2026-10-01',
    dueDate: '2026-10-02',
    status: 'open',
    tapdUrl: 'https://www.tapd.cn/tapd_fe/1/task/detail/1',
    ...partial,
  };
}

describe('createDefaultFilters', () => {
  it('默认不筛选（null = 全选）', () => {
    const filters = createDefaultFilters({ start: '2026-10-01', end: '2026-10-31' });
    expect(filters).toEqual({
      range: { start: '2026-10-01', end: '2026-10-31' },
      projectIds: null,
      memberKeys: null,
      statuses: null,
    });
  });
});

describe('isCompletedStatus', () => {
  it('命中 TAPD 常见终态（忽略大小写与空格）', () => {
    expect(isCompletedStatus('done')).toBe(true);
    expect(isCompletedStatus(' DONE ')).toBe(true);
    expect(isCompletedStatus('Closed')).toBe(true);
    expect(isCompletedStatus('resolved')).toBe(true);
    expect(isCompletedStatus('rejected')).toBe(true);
  });

  it('未完成与未知状态一律按未完成处理', () => {
    expect(isCompletedStatus('open')).toBe(false);
    expect(isCompletedStatus('progressing')).toBe(false);
    expect(isCompletedStatus('已完成')).toBe(false);
    expect(isCompletedStatus('')).toBe(false);
  });
});

describe('collectStatusOptions', () => {
  it('按来源类型 + 状态去重计数，任务排在缺陷前', () => {
    const options = collectStatusOptions([
      task({ id: '1', status: 'open' }),
      task({ id: '2', status: 'open' }),
      task({ id: '3', status: 'done' }),
      task({ id: '4', sourceType: 'bug', status: 'closed' }),
      task({ id: '5', sourceType: 'bug', status: 'in_progress' }),
      task({ id: '6', sourceType: 'bug', status: 'closed' }),
    ]);

    expect(options).toEqual([
      { sourceType: 'task', value: 'open', count: 2 },
      { sourceType: 'task', value: 'done', count: 1 },
      { sourceType: 'bug', value: 'closed', count: 2 },
      { sourceType: 'bug', value: 'in_progress', count: 1 },
    ]);
  });

  it('空数据返回空列表', () => {
    expect(collectStatusOptions([])).toEqual([]);
  });

  it('同名状态在不同来源下不合并', () => {
    const options = collectStatusOptions([
      task({ id: '1', status: 'closed' }),
      task({ id: '2', sourceType: 'bug', status: 'closed' }),
    ]);
    expect(options).toEqual([
      { sourceType: 'task', value: 'closed', count: 1 },
      { sourceType: 'bug', value: 'closed', count: 1 },
    ]);
    expect(statusKey('task', 'closed')).not.toBe(statusKey('bug', 'closed'));
  });
});

describe('filterTasks', () => {
  const tasks = [
    task({ id: '1', projectId: 'P1', status: 'open' }),
    task({ id: '2', projectId: 'P2', status: 'done' }),
    task({ id: '3', projectId: 'P2', status: 'open' }),
    task({ id: '4', sourceType: 'bug', projectId: 'P1', status: 'closed' }),
  ];

  it('null 表示不筛选', () => {
    expect(filterTasks(tasks, { projectIds: null, statuses: null })).toHaveLength(4);
  });

  it('按项目过滤', () => {
    const result = filterTasks(tasks, { projectIds: ['P2'], statuses: null });
    expect(result.map((item) => item.id)).toEqual(['2', '3']);
  });

  it('按来源类型 + 状态过滤，不误伤同名状态', () => {
    const result = filterTasks(tasks, {
      projectIds: null,
      statuses: [statusKey('bug', 'closed')],
    });
    expect(result.map((item) => item.id)).toEqual(['4']);
  });

  it('空数组表示全部取消，结果为 0 条', () => {
    expect(filterTasks(tasks, { projectIds: [], statuses: null })).toHaveLength(0);
  });
});

describe('validateRange', () => {
  it('合法范围直接返回并给出提示', () => {
    expect(validateRange('2026-10-01', '2026-10-31')).toEqual({
      range: { start: '2026-10-01', end: '2026-10-31' },
      error: '',
      note: '',
    });
  });

  it('非法日期与倒挂给出错误且不返回范围', () => {
    expect(validateRange('2026-13-01', '2026-10-31').error).toContain('有效');
    expect(validateRange('2026-10-31', '2026-10-01').error).toContain('不能晚于');
    expect(validateRange('2026-10-31', '2026-10-01').range).toBeNull();
  });

  it('超过上限时截断并提示', () => {
    const result = validateRange('2026-01-01', '2027-12-31');
    expect(result.error).toBe('');
    expect(result.note).toContain('截断');
    expect(result.range).toEqual({ start: '2026-01-01', end: '2027-01-02' });
  });

  it('范围较长时给出数据量提示', () => {
    const result = validateRange('2026-01-01', '2026-06-30');
    expect(result.range).not.toBeNull();
    expect(result.note).toContain('较多数据');
  });

  it('上限与提示阈值符合常量定义', () => {
    expect(MAX_RANGE_DAYS).toBe(366);
    expect(LARGE_RANGE_DAYS).toBe(92);
  });
});
