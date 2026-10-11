import { describe, expect, it } from 'vitest';

import { createStressFixtureTasks } from '@/fixtures/ganttFixture';
import { createMemberResolution, membersFromTasks } from '@/utils/memberResolution';

import { currentMonthRange } from './dateUtils';
import { computeLayout } from './layout';

/** 宽松阈值：只用于拦住灾难性回归（例如把布局算成 O(n²)），不用于精确基准。 */
const LAYOUT_BUDGET_MS = 1500;

describe('布局性能', () => {
  it('2000 条任务、8 名成员、10 个项目下布局在预算内完成', () => {
    const tasks = createStressFixtureTasks(2000);
    const members = membersFromTasks(tasks);
    const resolution = createMemberResolution(tasks, members);

    const startedAt = performance.now();
    const layout = computeLayout({
      tasks,
      range: currentMonthRange(),
      memberKeysOf: resolution.memberKeysOf,
      memberNames: resolution.memberNames,
    });
    const elapsed = performance.now() - startedAt;

    expect(layout.bars).toHaveLength(tasks.length);
    // 成员标题行 + 每条任务一行
    expect(layout.rows.length).toBe(tasks.length + members.length);
    expect(elapsed).toBeLessThan(LAYOUT_BUDGET_MS);
  });
});
