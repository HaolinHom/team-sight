// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySettings } from '@/types/settings';
import { useSettings } from '@/composables/useSettings';
import HoursSettingsCard from './HoursSettingsCard.vue';
const mocks=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}));
vi.mock('@/services/settings',()=>({loadSettings:mocks.load,saveSettings:mocks.save}));
beforeEach(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
 Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
 Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
 const settings=createEmptySettings();settings.projects=[{id:'p',name:'项目',enabled:true,color:'#3b82f6'}];settings.members=[{staffId:'100',name:'甲'}];
 mocks.load.mockReset().mockResolvedValue({settings});mocks.save.mockReset().mockResolvedValue(undefined);await useSettings().load(true);
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const save=(wrapper:ReturnType<typeof mount>)=>wrapper.findAll('button').find(button=>button.text()==='保存工时配置')!.trigger('click');
describe('工时设置',()=>{
 it('默认8，保存小数成功才提交状态，重新加载后保留',async()=>{
  const store=useSettings(),wrapper=mount(HoursSettingsCard);expect(wrapper.get<HTMLInputElement>('input[aria-label="每日规定工时"]').element.value).toBe('8');
  let finish!:()=>void;mocks.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  await wrapper.get('input[aria-label="每日规定工时"]').setValue('7.5');await save(wrapper);await flushPromises();expect(store.settings.value.hours.dailyRequiredHours).toBe(8);
  finish();await flushPromises();expect(store.settings.value.hours.dailyRequiredHours).toBe(7.5);expect(wrapper.text()).toContain('已保存');
  mocks.load.mockResolvedValue({settings:JSON.parse(JSON.stringify(store.settings.value))});await store.load(true);expect(store.settings.value.hours.dailyRequiredHours).toBe(7.5);wrapper.unmount();
 });
 it.each(['0','-1',''])('非法输入 %s 不写配置',async value=>{
  const wrapper=mount(HoursSettingsCard);await wrapper.get('input[aria-label="每日规定工时"]').setValue(value);await save(wrapper);
  expect(mocks.save).not.toHaveBeenCalled();expect(wrapper.get('[role="alert"]').text()).toContain('大于 0');expect(useSettings().settings.value.hours.dailyRequiredHours).toBe(8);wrapper.unmount();
 });
 it('保存失败恢复确认值，错误保留，后续写入仍可成功',async()=>{
  const wrapper=mount(HoursSettingsCard);mocks.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
  await wrapper.get('input[aria-label="每日规定工时"]').setValue('6');await save(wrapper);await flushPromises();
  expect(useSettings().settings.value.hours.dailyRequiredHours).toBe(8);expect(wrapper.get<HTMLInputElement>('input[aria-label="每日规定工时"]').element.value).toBe('8');expect(useSettings().saveError.value).toContain('磁盘写入失败');
  await wrapper.get('input[aria-label="每日规定工时"]').setValue('7.5');await save(wrapper);await flushPromises();expect(useSettings().settings.value.hours.dailyRequiredHours).toBe(7.5);wrapper.unmount();
 });
 it('移除手动日期，豁免、项目终态仍可编辑并持久化',async()=>{
  const wrapper=mount(HoursSettingsCard);expect(wrapper.find('input[aria-label="日历覆盖日期"]').exists()).toBe(false);
  await wrapper.get('[data-date="2026-10-14"]').trigger('click');
  await wrapper.findAll('button').find(button=>button.text()==='添加成员')!.trigger('click');
  await wrapper.get('[aria-label="请假工时 1"]').setValue('4');await wrapper.get('dialog form').trigger('submit');
  expect(mocks.save).not.toHaveBeenCalled();expect(useSettings().settings.value.hours.exemptions).toEqual([]);expect(wrapper.text()).toContain('待保存');
  await wrapper.get('[aria-label="下个月"]').trigger('click');await wrapper.get('[aria-label="上个月"]').trigger('click');expect(wrapper.get('[data-date="2026-10-14"]').text()).toContain('甲 · 4h');
  await wrapper.findAll('button').find(button=>button.text()==='添加结束状态')!.trigger('click');
  await wrapper.get('input[aria-label="结束状态原值"]').setValue('已验收，已取消');await save(wrapper);await flushPromises();
  expect(useSettings().settings.value.hours).toMatchObject({exemptions:[{staffId:'100',date:'2026-10-14',hours:4}],completedStates:[{projectId:'p',type:'task',values:['已验收','已取消']}]});
  expect(wrapper.text()).not.toContain('待保存');expect(wrapper.text()).toContain('配置已保存');
  mocks.load.mockResolvedValue({settings:JSON.parse(JSON.stringify(useSettings().settings.value))});await useSettings().load(true);await flushPromises();expect(wrapper.get('[data-date="2026-10-14"]').text()).toContain('甲 · 4h');wrapper.unmount();
 });
 it('请假保存失败恢复已保存日历，再次编辑可成功保存',async()=>{
  const wrapper=mount(HoursSettingsCard);mocks.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
  const edit=async()=>{await wrapper.get('[data-date="2026-10-19"]').trigger('click');await wrapper.findAll('button').find(button=>button.text()==='添加成员')!.trigger('click');await wrapper.get('dialog form').trigger('submit');};
  await edit();await save(wrapper);await flushPromises();expect(useSettings().settings.value.hours.exemptions).toEqual([]);expect(wrapper.get('[data-date="2026-10-19"]').text()).not.toContain('8h');expect(useSettings().saveError.value).toContain('磁盘写入失败');
  await edit();await save(wrapper);await flushPromises();expect(useSettings().settings.value.hours.exemptions[0].hours).toBe(8);wrapper.unmount();
 });
});
