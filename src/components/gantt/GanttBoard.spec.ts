// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { GANTT_FIXTURE_COLLAPSED_MEMBERS, GANTT_FIXTURE_TASKS } from '@/fixtures/ganttFixture';
import { DEFAULT_LAYOUT_CONFIG } from '@/gantt/layout';

import GanttBoard from './GanttBoard.vue';

const RANGE = { start: '2026-10-01', end: '2026-10-31' };
/** 固定验收数据里有 13 条任务，其中王五（staff:800100003）占 3 条。 */
const COLLAPSED_TASK_COUNT = 3;

function mountBoard(collapsedMemberKeys: readonly string[] = []) {
  return mount(GanttBoard, {
    props: {
      tasks: GANTT_FIXTURE_TASKS,
      range: RANGE,
      collapsedMemberKeys: [...collapsedMemberKeys],
      today: '2026-10-11',
    },
  });
}

function topOf(wrapper: ReturnType<typeof mountBoard>, memberName: string): number {
  const rows = wrapper.findAll('.gantt__label-row--member');
  const row = rows.find((item) => item.text().includes(memberName));
  if (!row) throw new Error(`未找到成员行：${memberName}`);
  return Number.parseInt(row.attributes('style')?.match(/top:\s*(\d+)px/)?.[1] ?? 'NaN', 10);
}

describe('GanttBoard 布局渲染', () => {
  it('表头与背景共用日历：周中休假标灰，周末补班取消灰底', async () => {
    const wrapper = mountBoard();
    const before = wrapper.findAll('.gantt__bar').map(bar => bar.attributes('x'));
    await wrapper.setProps({ calendar: { '2026-10-01': { working: false, name: '国庆节' }, '2026-10-10': { working: true, name: '补班' } } });
    const headers = wrapper.findAll('.gantt__day');
    expect(headers[0].classes()).toContain('gantt__day--weekend');
    expect(headers[9].classes()).not.toContain('gantt__day--weekend');
    const background = wrapper.findAll('.gantt__svg > g:first-child rect');
    expect(background.some(rect => Number(rect.attributes('x')) === 0)).toBe(true);
    expect(background.some(rect => Number(rect.attributes('x')) === 9 * DEFAULT_LAYOUT_CONFIG.dayColumnWidth)).toBe(false);
    expect(wrapper.findAll('.gantt__bar').map(bar => bar.attributes('x'))).toEqual(before);
    wrapper.unmount();
  });
  it('成员标题行不显示任务条，每个任务独占一行', () => {
    const wrapper = mountBoard();

    expect(wrapper.findAll('.gantt__label-row--member').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(GANTT_FIXTURE_TASKS.length);
    // 只有日期齐备的任务才产生任务条（缺失日期与日期倒挂不画条）
    expect(wrapper.findAll('.gantt__bar')).toHaveLength(10);
    expect(wrapper.findAll('.gantt__member-name').length).toBe(4);
  });

  it('折叠成员隐藏其任务行，展开后恢复且后续成员行不错位', async () => {
    const wrapper = mountBoard(GANTT_FIXTURE_COLLAPSED_MEMBERS);

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(
      GANTT_FIXTURE_TASKS.length - COLLAPSED_TASK_COUNT
    );
    expect(wrapper.findAll('button[aria-label="展开成员"]')).toHaveLength(1);

    const before = topOf(wrapper, '张三');

    // 折叠状态由页面持有：组件只上报点击，展开效果通过更新 props 体现
    await wrapper.find('button[aria-label="展开成员"]').trigger('click');
    expect(wrapper.emitted('toggle-member')).toHaveLength(1);
    await wrapper.setProps({ collapsedMemberKeys: [] });

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(GANTT_FIXTURE_TASKS.length);
    expect(wrapper.findAll('button[aria-label="展开成员"]')).toHaveLength(0);

    const after = topOf(wrapper, '张三');
    expect(after - before).toBe(COLLAPSED_TASK_COUNT * DEFAULT_LAYOUT_CONFIG.taskRowHeight);
  });

  it('折叠控件点击后回调成员键，供页面保存折叠状态', async () => {
    const wrapper = mountBoard();

    await wrapper.findAll('button[aria-label="折叠成员"]')[0].trigger('click');

    const events = wrapper.emitted('toggle-member');
    expect(events).toHaveLength(1);
    expect(typeof events?.[0][0]).toBe('string');
  });
});
