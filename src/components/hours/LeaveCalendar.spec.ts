// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LeaveCalendar from './LeaveCalendar.vue';
import type { LeaveExemption } from '@/types/hours';

let wrapper: VueWrapper;
const members = [{ staffId: '100', name: '甲' }, { staffId: '200', name: '乙' }];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T17:00:00Z'));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.useRealTimers(); });
function start(modelValue: LeaveExemption[] = [], configuredMembers = members) {
  wrapper = mount(LeaveCalendar, { props: { modelValue, members: configuredMembers }, attachTo: document.body });
  return wrapper;
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); }
async function month(value: string) { await wrapper.get('input[type="month"]').setValue(value); }
const updated = () => wrapper.emitted('update:modelValue')!.at(-1)![0] as LeaveExemption[];

describe('成员请假月历', () => {
  it('使用北京时间今天、周一开头，支持跨年、闰年和返回本月', async () => {
    start();
    expect(wrapper.get('input[type="month"]').element).toHaveProperty('value', '2026-10');
    expect(wrapper.get('[aria-current="date"]').attributes('data-date')).toBe('2026-10-19');
    expect(wrapper.findAll('th').map(th => th.text())).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    await month('2026-12'); await wrapper.get('[aria-label="下个月"]').trigger('click');
    expect(wrapper.get('input[type="month"]').element).toHaveProperty('value', '2027-01');
    await wrapper.get('[aria-label="上个月"]').trigger('click');
    expect(wrapper.get('input[type="month"]').element).toHaveProperty('value', '2026-12');
    await month('2028-02'); expect(wrapper.findAll('.calendar-day')).toHaveLength(29);
    await month('2027-02'); expect(wrapper.findAll('.calendar-day')).toHaveLength(28);
    await click('返回本月'); expect(wrapper.get('input[type="month"]').element).toHaveProperty('value', '2026-10');
    await month(''); expect(wrapper.get('input[type="month"]').element).toHaveProperty('value', '2026-10');
  });
  it('配置多成员、默认8h、小数和说明，确认仅上报草稿，按成员顺序展示', async () => {
    const original: LeaveExemption[] = [];
    start(original); await wrapper.get('[data-date="2026-10-19"]').trigger('click');
    expect(wrapper.get('dialog').element).toHaveProperty('open', true);
    await click('添加成员'); expect(wrapper.get('[aria-label="请假工时 1"]').element).toHaveProperty('value', '8');
    await wrapper.get('[aria-label="请假工时 1"]').setValue('3.5');
    await wrapper.get('[aria-label="请假说明 1"]').setValue('事假');
    await click('添加成员');
    expect(wrapper.get('[aria-label="请假成员 2"] option[value="100"]').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('button').find(button => button.text() === '添加成员')!.attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(updated()).toEqual([{ staffId: '100', date: '2026-10-19', hours: 3.5, note: '事假' }, { staffId: '200', date: '2026-10-19', hours: 8, note: '' }]);
    expect(original).toEqual([]);
    await wrapper.setProps({ modelValue: [...updated()].reverse() });
    expect(wrapper.get('[data-date="2026-10-19"]').findAll('.leave-entry').map(item => item.text())).toEqual(['甲 · 3.5h', '乙 · 8h']);
    await wrapper.get('[aria-label="下个月"]').trigger('click'); await wrapper.get('[aria-label="上个月"]').trigger('click');
    expect(wrapper.get('[data-date="2026-10-19"]').text()).toContain('甲 · 3.5h');
  });
  it.each(['0', '-1', ''])('工时 %s 阻止确认并保留弹窗', async value => {
    start(); await wrapper.get('[data-date="2026-10-19"]').trigger('click'); await click('添加成员');
    await wrapper.get('[aria-label="请假工时 1"]').setValue(value); await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('大于 0'); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  it('校验重复成员，编辑移除仅替换当天记录', async () => {
    const otherDay = { staffId: '100', date: '2026-10-20', hours: 8, note: '' };
    start([{ ...otherDay, date: '2026-10-19' }, otherDay]);
    await wrapper.get('[data-date="2026-10-19"]').trigger('click'); await click('添加成员');
    await wrapper.get('[aria-label="请假成员 2"]').setValue('100'); await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('只能配置一条');
    await wrapper.get('[aria-label="移除请假成员 2"]').trigger('click');
    await wrapper.get('[aria-label="请假工时 1"]').setValue('4'); await wrapper.get('form').trigger('submit');
    expect(updated()).toEqual([otherDay, { ...otherDay, date: '2026-10-19', hours: 4 }]);
    await wrapper.setProps({ modelValue: updated() });
    await wrapper.get('[data-date="2026-10-19"]').trigger('click'); await wrapper.get('[aria-label="移除请假成员 1"]').trigger('click');
    await wrapper.get('form').trigger('submit'); expect(updated()).toEqual([otherDay]);
  });
  it.each(['取消', '关闭', 'Esc'])('%s 放弃弹窗修改并恢复日期焦点', async method => {
    start(); const day = wrapper.get<HTMLButtonElement>('[data-date="2026-10-19"]');
    day.element.focus(); await day.trigger('click'); await click('添加成员');
    if (method === '取消') await click('取消');
    else if (method === '关闭') await wrapper.get('[aria-label="关闭请假编辑"]').trigger('click');
    else await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.find('dialog').exists()).toBe(false); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(document.activeElement).toBe(day.element);
    await day.trigger('click'); expect(wrapper.text()).toContain('当天尚未配置请假');
  });
  it('Tab与Shift+Tab在弹窗内循环', async () => {
    start(); await wrapper.get('[data-date="2026-10-19"]').trigger('click');
    const first = wrapper.get<HTMLButtonElement>('[aria-label="关闭请假编辑"]');
    const last = wrapper.get<HTMLButtonElement>('button[type="submit"]');
    expect(document.activeElement).toBe(first.element);
    await first.trigger('keydown', { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last.element);
    await last.trigger('keydown', { key: 'Tab' }); expect(document.activeElement).toBe(first.element);
  });
  it('无成员提示，保存期间不可编辑', async () => {
    start([], []); expect(wrapper.text()).toContain('请先添加展示成员');
    expect(wrapper.get('[data-date="2026-10-19"]').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ members, disabled: true });
    expect(wrapper.get('[aria-label="下个月"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-date="2026-10-19"]').attributes('disabled')).toBeDefined();
  });
});
