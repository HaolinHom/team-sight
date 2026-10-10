import { describe, expect, it } from 'vitest';

import { GANTT_FIXTURE_COLLAPSED_MEMBERS, GANTT_FIXTURE_TASKS } from './ganttFixture';
import { dateDiffInDays } from '@/gantt/dateUtils';
import { resolveDateIssue, resolveMemberKey } from '@/gantt/layout';

/**
 * 固定验收数据必须持续满足技术方案 §7.6 的清单，
 * 否则 §10.3 视觉验收会失去意义。
 */
describe('甘特图固定验收数据', () => {
  const tasks = GANTT_FIXTURE_TASKS;

  it('至少 2 名成员，且成员任务数不等', () => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const key = resolveMemberKey(task);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(2);
    expect(new Set(counts.values()).size).toBeGreaterThan(1);
  });

  it('前两名成员各有 3 个以上任务', () => {
    const counts = [...tasks.reduce((map, task) => {
      const key = resolveMemberKey(task);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())].sort((left, right) => right[1] - left[1]);

    expect(counts[0][1]).toBeGreaterThanOrEqual(3);
    expect(counts[1][1]).toBeGreaterThanOrEqual(3);
  });

  it('包含多个项目与不同颜色', () => {
    const colors = new Set(tasks.map((task) => task.projectColor));
    expect(new Set(tasks.map((task) => task.projectId)).size).toBeGreaterThanOrEqual(3);
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it('同一成员存在日期重叠的任务', () => {
    const byMember = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const key = resolveMemberKey(task);
      byMember.set(key, [...(byMember.get(key) ?? []), task]);
    }

    const hasOverlap = [...byMember.values()].some((group) =>
      group.some((left, index) =>
        group.slice(index + 1).some((right) => {
          if (!left.startDate || !left.dueDate || !right.startDate || !right.dueDate) return false;
          return left.startDate <= right.dueDate && right.startDate <= left.dueDate;
        })
      )
    );
    expect(hasOverlap).toBe(true);
  });

  it('包含跨多天任务与跨越自然月边界的任务', () => {
    const spans = tasks
      .filter((task) => task.startDate && task.dueDate)
      .map((task) => dateDiffInDays(task.startDate as string, task.dueDate as string));
    expect(Math.max(...spans)).toBeGreaterThan(3);

    const crossesMonth = tasks.some(
      (task) =>
        task.startDate &&
        task.dueDate &&
        task.startDate.slice(0, 7) !== task.dueDate.slice(0, 7)
    );
    expect(crossesMonth).toBe(true);
  });

  it('保留缺失日期与日期倒挂样本', () => {
    const issues = tasks.map(resolveDateIssue).filter(Boolean);
    expect(issues).toContain('missing-both');
    expect(issues).toContain('missing-start');
    expect(issues).toContain('reversed');
  });

  it('折叠成员有任务且出现在折叠名单中', () => {
    const collapsed = GANTT_FIXTURE_COLLAPSED_MEMBERS[0];
    expect(collapsed).toBeTruthy();
    expect(tasks.filter((task) => resolveMemberKey(task) === collapsed).length).toBeGreaterThan(0);
  });

  it('任务键唯一（去重键为来源类型 + ID）', () => {
    const keys = tasks.map((task) => `${task.sourceType}:${task.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
