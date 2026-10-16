import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT_CONFIG, computeLayout, groupTasksByMember, resolveMemberKey } from './layout';
import type { ScheduleTask } from '@/types/schedule';

const RANGE = { start: '2026-10-01', end: '2026-10-10' };

function task(partial: Partial<ScheduleTask> & Pick<ScheduleTask, 'id' | 'title'>): ScheduleTask {
  return {
    sourceType: 'task',
    projectId: 'P1',
    projectName: '项目一',
    projectColor: '#3b82f6',
    assigneeId: '800100001',
    assigneeName: '张三',
    assigneeIds: ['800100001'],
    startDate: '2026-10-01',
    dueDate: '2026-10-02',
    status: 'open',
    tapdUrl: 'https://www.tapd.cn/tapd_fe/1/task/detail/1',
    ...partial,
  };
}

describe('resolveMemberKey', () => {
  it('优先使用工号，缺工号时退回姓名', () => {
    expect(resolveMemberKey({ assigneeId: '800100001', assigneeName: '张三' })).toBe(
      'staff:800100001'
    );
    expect(resolveMemberKey({ assigneeId: null, assigneeName: '张三' })).toBe('name:张三');
    expect(resolveMemberKey({ assigneeId: null, assigneeName: '' })).toBe('unassigned');
  });
});

describe('groupTasksByMember', () => {
  it('配置顺序优先于姓名与工号，缺少顺序的成员沿用旧排序', () => {
    const tasks = [
      task({ id: '1', title: 'A', assigneeId: '100', assigneeName: '张三' }),
      task({ id: '2', title: 'B', assigneeId: '200', assigneeName: '李四' }),
      task({ id: '3', title: 'C', assigneeId: '300', assigneeName: '李四' }),
      task({ id: '4', title: 'D', assigneeId: null, assigneeName: '' }),
    ];
    expect(groupTasksByMember(tasks, { memberOrder: ['staff:100', 'staff:300', 'staff:200'] }).map(group => group.key))
      .toEqual(['staff:100', 'staff:300', 'staff:200', 'unassigned']);
    expect(groupTasksByMember(tasks, { memberOrder: ['staff:100'] }).map(group => group.key))
      .toEqual(['staff:100', 'staff:200', 'staff:300', 'unassigned']);
  });

  it('未分配成员固定排最后，且同名不同工号不合并', () => {
    const groups = groupTasksByMember([
      task({ id: '1', title: 'A', assigneeId: null, assigneeName: '' }),
      task({ id: '2', title: 'B', assigneeId: '900', assigneeName: '李四' }),
      task({ id: '3', title: 'C', assigneeId: '800', assigneeName: '李四' }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['staff:800', 'staff:900', 'unassigned']);
    expect(groups[2].memberName).toBe('未分配成员');
  });

  it('组内按开始日、截止日、项目、ID 稳定排序', () => {
    const groups = groupTasksByMember([
      task({ id: 'b', title: 'B', startDate: '2026-10-05', dueDate: '2026-10-06' }),
      task({ id: 'a', title: 'A', startDate: '2026-10-02', dueDate: '2026-10-03' }),
      task({ id: 'c', title: 'C', startDate: '2026-10-02', dueDate: '2026-10-02' }),
    ]);

    expect(groups[0].tasks.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('computeLayout', () => {
  it('多负责人按配置分组，折叠和筛选不改变相对顺序及组内任务排序', () => {
    const tasks = [
      task({ id: 'later', title: '后开始', assigneeIds: ['100', '200', '300'], startDate: '2026-10-03' }),
      task({ id: 'earlier', title: '先开始', assigneeIds: ['100', '200', '300'] }),
    ];
    const input = {
      tasks, range: RANGE, memberOrder: ['staff:300', 'staff:100', 'staff:200'],
      memberKeysOf: (item: ScheduleTask) => item.assigneeIds.map(id => `staff:${id}`),
    };
    const layout = computeLayout({ ...input, collapsedMemberKeys: ['staff:100'] });
    expect(layout.memberGroups.map(group => group.key)).toEqual(input.memberOrder);
    expect(layout.memberGroups.every(group => group.tasks.map(item => item.id).join() === 'earlier,later')).toBe(true);
    expect(layout.rows.filter(row => row.type === 'task').map(row => row.memberKey)).toEqual(['staff:300', 'staff:300', 'staff:200', 'staff:200']);
    const filtered = computeLayout({ ...input, memberKeysOf: () => ['staff:100', 'staff:300'] });
    expect(filtered.memberGroups.map(group => group.key)).toEqual(['staff:300', 'staff:100']);
  });

  it('成员标题行与任务行共用同一套纵坐标计算', () => {
    const layout = computeLayout({
      tasks: [
        task({ id: '1', title: 'A' }),
        task({ id: '2', title: 'B', startDate: '2026-10-03', dueDate: '2026-10-04' }),
      ],
      range: RANGE,
    });

    const { memberRowHeight, taskRowHeight } = DEFAULT_LAYOUT_CONFIG;
    expect(layout.rows.map((row) => row.type)).toEqual(['member', 'task', 'task']);
    expect(layout.rows[0].y).toBe(0);
    expect(layout.rows[1].y).toBe(memberRowHeight);
    expect(layout.rows[2].y).toBe(memberRowHeight + taskRowHeight);
    expect(layout.totalHeight).toBe(memberRowHeight + taskRowHeight * 2);
  });

  it('折叠成员后不生成其任务行，并重排后续行', () => {
    const expanded = computeLayout({
      tasks: [task({ id: '1', title: 'A' }), task({ id: '2', title: 'B', assigneeId: '800100002' })],
      range: RANGE,
    });
    const collapsed = computeLayout({
      tasks: [task({ id: '1', title: 'A' }), task({ id: '2', title: 'B', assigneeId: '800100002' })],
      range: RANGE,
      collapsedMemberKeys: ['staff:800100001'],
    });

    expect(expanded.rows.length).toBe(4);
    expect(collapsed.rows.length).toBe(3);
    expect(collapsed.totalHeight).toBe(
      DEFAULT_LAYOUT_CONFIG.memberRowHeight * 2 + DEFAULT_LAYOUT_CONFIG.taskRowHeight
    );
    expect(collapsed.todayX).toBe(expanded.todayX);
  });

  it('任务条 x/width 按自然日区间计算', () => {
    const layout = computeLayout({
      tasks: [task({ id: '1', title: 'A', startDate: '2026-10-03', dueDate: '2026-10-05' })],
      range: RANGE,
    });

    const { dayColumnWidth } = DEFAULT_LAYOUT_CONFIG;
    const [bar] = layout.bars;
    expect(bar.x).toBe(2 * dayColumnWidth);
    expect(bar.width).toBe(3 * dayColumnWidth);
    expect(bar.y).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_CONFIG.memberRowHeight);
  });

  it('跨越时间窗的任务按窗口裁剪，原始日期不变', () => {
    const layout = computeLayout({
      tasks: [
        task({ id: '1', title: '跨月', startDate: '2026-09-25', dueDate: '2026-10-03' }),
      ],
      range: RANGE,
    });

    const [bar] = layout.bars;
    expect(bar.x).toBe(0);
    expect(bar.clippedStart).toBe(true);
    expect(bar.clippedEnd).toBe(false);
    expect(bar.startDate).toBe('2026-09-25');
    expect(bar.width).toBe(3 * DEFAULT_LAYOUT_CONFIG.dayColumnWidth);
  });

  it('缺失日期与日期倒挂的任务不生成任务条，仅登记为待排期', () => {
    const layout = computeLayout({
      tasks: [
        task({ id: '1', title: '仅截止日', startDate: null, dueDate: '2026-10-05' }),
        task({ id: '2', title: '无日期', startDate: null, dueDate: null }),
        task({ id: '3', title: '倒挂', startDate: '2026-10-08', dueDate: '2026-10-04' }),
      ],
      range: RANGE,
    });

    expect(layout.bars).toHaveLength(0);
    // 缺失开始日的任务排在末尾（与行内排序规则一致）
    expect(layout.unscheduledTaskIds).toEqual(['task:3', 'task:1', 'task:2']);
    expect(layout.rows.filter((row) => row.type === 'task')).toHaveLength(3);
  });

  it('当日标记超出时间窗时为 null', () => {
    expect(computeLayout({ tasks: [], range: RANGE, today: '2026-11-20' }).todayX).toBeNull();
    expect(computeLayout({ tasks: [], range: RANGE, today: '2026-10-02' }).todayX).toBe(
      DEFAULT_LAYOUT_CONFIG.dayColumnWidth * 1.5
    );
  });

  it('多负责人任务在多个成员分组下各占一行', () => {
    const layout = computeLayout({
      tasks: [task({ id: '1', title: '联调', assigneeIds: ['800100001', '800100002'] })],
      range: RANGE,
      memberKeysOf: (item) => item.assigneeIds.map((staffId) => `staff:${staffId}`),
      memberNames: new Map([
        ['staff:800100001', '张三'],
        ['staff:800100002', '李四'],
      ]),
    });

    const memberRows = layout.rows.filter((row) => row.type === 'member');
    const taskRows = layout.rows.filter((row) => row.type === 'task');
    expect(memberRows).toHaveLength(2);
    expect(taskRows).toHaveLength(2);
    expect(layout.bars).toHaveLength(2);
    expect(layout.bars.map((bar) => bar.memberKey)).toEqual([
      'staff:800100002',
      'staff:800100001',
    ]);
    expect(memberRows.map((row) => (row.type === 'member' ? row.memberName : ''))).toEqual([
      '李四',
      '张三',
    ]);
  });

  it('成员键为空的任务不生成行（被成员过滤隐藏）', () => {
    const layout = computeLayout({
      tasks: [task({ id: '1', title: '无归属' })],
      range: RANGE,
      memberKeysOf: () => [],
    });

    expect(layout.rows).toHaveLength(0);
    expect(layout.bars).toHaveLength(0);
    expect(layout.totalHeight).toBe(0);
  });
});
