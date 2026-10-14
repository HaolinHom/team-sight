// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySettings } from '@/types/settings';
import type { HoursSnapshot } from '@/types/hours';
import type { ScheduleTask } from '@/types/schedule';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),invoke:vi.fn(),open:vi.fn()}));
vi.mock('@/services/tapd/hours',async importOriginal=>({...await importOriginal<typeof import('@/services/tapd/hours')>(),fetchHoursSnapshot:mocks.fetch}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@/hours/workerClient', async () => {
 const {calculateHours}=await import('@/hours/statistics');
 return {createHoursCalculator:()=>({calculate:async(input:Parameters<typeof calculateHours>[0])=>({rows:calculateHours(input),calculationMs:0}),cancel:vi.fn()})};
});
vi.mock('@/services/externalLink',()=>({openExternalUrl:mocks.open}));
import HoursPage from './HoursPage.vue';
import { useSettings } from '@/composables/useSettings';
function task(id:string,member:string,effort:string):ScheduleTask {return {id,sourceType:'task',title:'任务'+id,projectId:'p',projectName:'项目',projectColor:'#3b82f6',assigneeId:member,assigneeIds:[member],assigneeName:member,startDate:'2026-10-14',dueDate:'2026-10-14',effort,status:'open',tapdUrl:'https://www.tapd.cn/tapd_fe/p/task/detail/'+id};}
const snapshot:HoursSnapshot={tasks:[task('A','100','8'),task('B','200','4')],records:[{id:'past',projectId:'p',entityType:'task',entityId:'outside',staffId:'100',spentDate:'2026-10-13',hours:6}],issues:[],status:'complete'};
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-14T02:00:00Z'));vi.stubEnv('VITE_HOURS_FIXTURE','');
 (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__={};
 const settings=createEmptySettings();settings.projects=[{id:'p',name:'项目',enabled:true,color:'#3b82f6'}];settings.members=[{staffId:'100',name:'张三'},{staffId:'200',name:'李四'}];
 mocks.invoke.mockReset().mockImplementation(async(command:string)=>command==='settings_read'?JSON.stringify(settings):command==='credential_status'?{configured:true,source:'file',maskedHint:null}:undefined);
 mocks.fetch.mockReset().mockResolvedValue(snapshot);mocks.open.mockReset().mockResolvedValue(undefined);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;});
const mountPage=async()=>{await useSettings().load(true);const wrapper=mount(HoursPage,{global:{stubs:{RouterLink:{template:'<a><slot /></a>'}}}});await flushPromises();await flushPromises();return wrapper;};
describe('每日工时页面',()=>{
 it('展示默认自然月矩阵，过去实际与今天预计分别标记',async()=>{
  const wrapper=await mountPage();expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.fetch.mock.calls[0][0].range).toEqual({start:'2026-10-01',end:'2026-10-31'});
  expect(wrapper.get('button[aria-label="张三 2026-10-13 实际 6h 缺 2h"]').attributes('data-state')).toBe('short');expect(wrapper.get('button[aria-label="张三 2026-10-14 预计 8h 预计充足"]').text()).toContain('已填报 0h');wrapper.unmount();
 });
 it('点击格子查看实际来源，明细筛选不修改汇总，可打开TAPD',async()=>{
  const wrapper=await mountPage();await wrapper.get('button[aria-label="张三 2026-10-13 实际 6h 缺 2h"]').trigger('click');
  const aside=wrapper.get('aside');expect(aside.text()).toContain('任务 outside');expect(aside.text()).toContain('实际 6h');
  await aside.get('a').trigger('click');expect(mocks.open).toHaveBeenCalledWith('https://www.tapd.cn/tapd_fe/p/task/detail/outside');
  await wrapper.get('select[aria-label="明细项目筛选"]').setValue('p');expect(wrapper.find('button[aria-label="张三 2026-10-13 实际 6h 缺 2h"]').exists()).toBe(true);wrapper.unmount();
 });
 it('目标保存后即时重算，不重新请求数据',async()=>{
  const wrapper=await mountPage();await useSettings().updateHours({...useSettings().settings.value.hours,dailyRequiredHours:7.5});await flushPromises();
  expect(wrapper.text()).toContain('规定 7.5h');expect(wrapper.find('button[aria-label="张三 2026-10-13 实际 6h 缺 1.5h"]').exists()).toBe(true);expect(mocks.fetch).toHaveBeenCalledTimes(1);wrapper.unmount();
 });
 it('部分失败显示待确认，不出现确定不足结论',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,status:'partial',issues:[{projectId:'p',affects:'both',message:'分页未完整'}]});const wrapper=await mountPage();
  expect(wrapper.get('button[aria-label="张三 2026-10-13 实际 6h 待确认"]').attributes('data-state')).toBe('unknown');expect(wrapper.text()).toContain('数据不完整');wrapper.unmount();
 });
 it('日期切换失败隐藏不同范围的旧数据，失败提示保留',async()=>{
  const wrapper=await mountPage();mocks.fetch.mockRejectedValueOnce(new Error('网络失败'));
  await wrapper.get('input[aria-label="开始日期"]').setValue('2026-11-01');await wrapper.get('input[aria-label="结束日期"]').setValue('2026-11-30');await wrapper.get('form').trigger('submit');await flushPromises();
  expect(wrapper.text()).toContain('网络失败');expect(wrapper.text()).toContain('已隐藏');expect(wrapper.find('.matrix').exists()).toBe(false);wrapper.unmount();
 });
 it('成员筛选和预计不足筛选作用于矩阵，打开失败明确反馈',async()=>{
  const wrapper=await mountPage();await wrapper.get('select[aria-label="成员筛选"]').setValue('200');expect(wrapper.find('button[aria-label="张三 2026-10-14 预计 8h 预计充足"]').exists()).toBe(false);
  await wrapper.get('select[aria-label="异常筛选"]').setValue('forecast');await wrapper.get('button[aria-label="李四 2026-10-14 预计 4h 缺 4h"]').trigger('click');mocks.open.mockRejectedValueOnce(new Error('打开失败'));await wrapper.get('aside a').trigger('click');await flushPromises();expect(wrapper.get('aside [role="alert"]').text()).toContain('打开失败');wrapper.unmount();
 });
});

it('大矩阵限制DOM数量，滚动可显示后续成员和日期',async()=>{
 const wrapper=await mountPage();useSettings().settings.value.members=Array.from({length:100},(_,i)=>({staffId:String(i+100),name:'成员'+i}));await flushPromises();await flushPromises();
 expect(wrapper.findAll('.day-cell').length).toBeLessThan(200);expect(wrapper.get('table').attributes('aria-rowcount')).toBe('101');
 const matrix=wrapper.get<HTMLElement>('.matrix');matrix.element.scrollTop=1440;matrix.element.scrollLeft=2200;await matrix.trigger('scroll');await new Promise(resolve=>setTimeout(resolve,30));await flushPromises();
 expect(wrapper.get('tbody .data-row').attributes('aria-rowindex')).not.toBe('2');expect(wrapper.get('thead').text()).not.toContain('10-01');wrapper.unmount();
});
