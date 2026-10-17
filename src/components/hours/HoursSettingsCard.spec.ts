// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySettings } from '@/types/settings';
import { useSettings } from '@/composables/useSettings';
import HoursSettingsCard from './HoursSettingsCard.vue';
const mocks=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}));
vi.mock('@/services/settings',()=>({loadSettings:mocks.load,saveSettings:mocks.save}));
beforeEach(async()=>{
 const settings=createEmptySettings();settings.projects=[{id:'p',name:'项目',enabled:true,color:'#3b82f6'}];settings.members=[{staffId:'100',name:'甲'}];
 mocks.load.mockReset().mockResolvedValue({settings});mocks.save.mockReset().mockResolvedValue(undefined);await useSettings().load(true);
});
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
  const wrapper=mount(HoursSettingsCard);expect(wrapper.find('input[aria-label="日历覆盖日期"]').exists()).toBe(false);for(const text of ['添加成员豁免','添加结束状态']) await wrapper.findAll('button').find(button=>button.text()===text)!.trigger('click');
  await wrapper.get('input[aria-label="豁免日期"]').setValue('2026-10-14');await wrapper.get('input[aria-label="结束状态原值"]').setValue('已验收，已取消');await save(wrapper);await flushPromises();
  expect(useSettings().settings.value.hours).toMatchObject({exemptions:[{staffId:'100',date:'2026-10-14'}],completedStates:[{projectId:'p',type:'task',values:['已验收','已取消']}]});wrapper.unmount();
 });
});
