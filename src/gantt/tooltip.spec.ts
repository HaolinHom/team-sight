import { describe, expect, it } from 'vitest';

import { buildTooltipContent } from './tooltip';
import type { ScheduleTask } from '@/types/schedule';

function task(partial: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: '1',
    sourceType: 'task',
    title: '用户登录改造',
    projectId: '63253157',
    projectName: '巨像销售中台产品线',
    projectColor: '#3b82f6',
    assigneeId: '800100001',
    assigneeName: '张三',
    assigneeIds: ['800100001'],
    startDate: '2026-10-01',
    dueDate: '2026-10-08',
    status: 'open',
    tapdUrl: 'https://www.tapd.cn/tapd_fe/63253157/task/detail/1',
    ...partial,
  };
}

describe('buildTooltipContent', () => {
  it('完整任务输出全部字段', () => {
    const content = buildTooltipContent(task({ priority: 'High' }));

    expect(content).toEqual({
      title: '用户登录改造',
      project: '巨像销售中台产品线',
      status: 'open',
      priority: 'High',
      assignee: '张三',
      dateRange: '2026-10-01 ~ 2026-10-08',
      notes: [],
    });
  });

  it('按时间窗裁剪时给出提示，但不改日期', () => {
    const content = buildTooltipContent(task(), { clippedStart: true });
    expect(content.notes).toEqual(['已按当前时间范围裁剪显示，原始日期不变']);
    expect(content.dateRange).toBe('2026-10-01 ~ 2026-10-08');
  });

  it('缺失日期与日期倒挂分别给出提示', () => {
    expect(buildTooltipContent(task({ startDate: null, dueDate: null })).notes[0]).toContain(
      '缺少开始与截止日期'
    );
    expect(buildTooltipContent(task({ startDate: null })).dateRange).toBe('仅截止日：2026-10-08');
    expect(buildTooltipContent(task({ dueDate: null })).dateRange).toBe('仅开始日：2026-10-01');
    expect(buildTooltipContent(task({ startDate: null, dueDate: null })).dateRange).toBe('无日期');
    expect(
      buildTooltipContent(task({ startDate: '2026-10-16', dueDate: '2026-10-12' })).notes[0]
    ).toContain('数据异常');
  });

  it('负责人缺失时显式标注未分配，状态缺失时标注未知', () => {
    const content = buildTooltipContent(task({ assigneeName: '', status: '' }));
    expect(content.assignee).toBe('未分配');
    expect(content.status).toBe('未知');
  });

  it('标题缺失时使用占位而不是空字符串', () => {
    expect(buildTooltipContent(task({ title: '' })).title).toBe('(无标题)');
  });
});
