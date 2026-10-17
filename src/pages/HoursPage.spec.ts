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
 it('待安排任务使用最新配置名称，不读取旧快照名称，未知项目回退ID',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,tasks:[{...task('pending','100','8'),startDate:null,dueDate:null},{...task('unknown','100','8'),projectId:'missing',startDate:null,dueDate:null}]});
  const wrapper=await mountPage();await wrapper.get('.pending-button').trigger('click');
  await useSettings().updateProject('p',{name:'简称'});await flushPromises();
  const names=wrapper.findAll('aside article .meta').map(item=>item.text());
  expect(names).toContain('简称 · open');expect(names).toContain('missing · open');
  expect(wrapper.get('select[aria-label="明细项目筛选"]').text()).toContain('简称');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);wrapper.unmount();
 });
 it('完整失败的问题名称随配置更新，随后网络失败不保留旧问题',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,status:'failed',issues:[{projectId:'p',affects:'both',message:'记录读取失败'}]});
  const wrapper=await mountPage();expect(wrapper.get('[role="alert"]').text()).toBe('项目：记录读取失败');
  await useSettings().updateProject('p',{name:'简称'});await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('简称：记录读取失败');expect(mocks.fetch).toHaveBeenCalledTimes(1);
  mocks.fetch.mockRejectedValueOnce(new Error('网络失败'));await wrapper.get('form button[type="button"]').trigger('click');await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('网络失败');wrapper.unmount();
 });
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
  expect(wrapper.get('button[aria-label="张三 2026-10-13 实际 6h 待确认 当日数据待确认 1个原因"]').attributes('data-state')).toBe('unknown');expect(wrapper.text()).toContain('数据不完整');wrapper.unmount();
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
 const firstRow=wrapper.get('tbody .data-row');
 expect(firstRow.attributes('aria-rowindex')).not.toBe('2');
 expect(firstRow.get('.member-column > strong').text()).toBe('成员'+(Number(firstRow.attributes('aria-rowindex'))-2));
 expect(wrapper.get('thead').text()).not.toContain('10-01');wrapper.unmount();
});

it('预计充足与待确认同时展示，待确认汇总和筛选仍包含达标日期',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,status:'partial',issues:[{projectId:'p',staffId:'100',date:'2026-10-14',affects:'forecast',message:'任务数据缺失'}]});
 const wrapper=await mountPage();
 const cell=wrapper.get('button[aria-label="张三 2026-10-14 预计 8h 预计充足 当日数据待确认 1个原因"]');
 expect(cell.attributes('data-state')).toBe('enough'); expect(cell.text()).toContain('当日数据待确认 · 1个原因');
 expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('数据待确认1 人日');
 await wrapper.get('select[aria-label="异常筛选"]').setValue('unknown'); expect(wrapper.find('button[aria-label="张三 2026-10-14 预计 8h 预计充足 当日数据待确认 1个原因"]').exists()).toBe(true);
 await cell.trigger('click'); expect(wrapper.get('aside').text()).toContain('预计分配仍可能随数据补全调整'); expect(wrapper.get('aside').text()).toContain('任务数据缺失'); wrapper.unmount();
});
it('今天实际已达标时明确显示实际达标并保留完整性提示',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,records:[{id:'today',projectId:'p',entityType:'task',entityId:'A',staffId:'100',spentDate:'2026-10-14',hours:8}],status:'partial',issues:[{projectId:'p',staffId:'100',date:'2026-10-14',affects:'both',message:'部分数据缺失'}]});
 const wrapper=await mountPage(); const cell=wrapper.get('button[aria-label="张三 2026-10-14 预计 8h 实际已达标 当日数据待确认 1个原因"]');
 await cell.trigger('click'); expect(wrapper.get('aside').text()).toContain('已记录的实际工时已达到目标'); wrapper.unmount();
});

it('未来休息日只显示豁免，不显示零工时或预测异常，汇总不包含这些日期',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,tasks:[...snapshot.tasks,{...task('missing','100','8'),effort:undefined,startDate:'2026-10-14',dueDate:'2026-10-30'}]});
 const wrapper=await mountPage();const cell=wrapper.get('button[aria-label="张三 2026-10-24 非工作日"]');
 expect(cell.text()).toBe('非工作日');expect(cell.text()).not.toContain('待确认');
 await cell.trigger('click');expect(wrapper.get('aside').text()).toContain('非工作日不受每日规定工时约束');expect(wrapper.get('aside').text()).not.toContain('预计充足不代表');
 expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('数据待确认13 人日');wrapper.unmount();
});
it('休息日实际填报保留，实际记录异常与预测异常分别处理',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,records:[{id:'weekend',projectId:'p',entityType:'task',entityId:'A',staffId:'100',spentDate:'2026-10-10',hours:2}],status:'partial',issues:[{projectId:'p',staffId:'100',date:'2026-10-10',affects:'actual',message:'实际记录未完整'},{projectId:'p',staffId:'100',date:'2026-10-10',affects:'forecast',message:'排期未完整'}]});
 const wrapper=await mountPage();const cell=wrapper.get('button[aria-label="张三 2026-10-10 实际 2h 非工作日 当日数据待确认 1个原因"]');
 expect(cell.text()).toContain('实际 2h');await cell.trigger('click');expect(wrapper.get('aside').text()).toContain('仅影响工时数据完整性');expect(wrapper.get('aside').text()).not.toContain('排期未完整');wrapper.unmount();
});

it('四项缺日期任务留在成员待安排中，不复制到后续零工时日期',async()=>{
 const tasks=[{...task('valid','100','4.5'),dueDate:'2026-10-26'},...Array.from({length:4},(_,i)=>({...task('invalid'+i,'100','8'),title:'未排期任务'+i,startDate:null,dueDate:null}))];
 mocks.fetch.mockResolvedValue({...snapshot,tasks,records:[]});const wrapper=await mountPage();
 const zero=wrapper.get('button[aria-label="张三 2026-10-27 预计 0h 缺 8h"]');expect(zero.text()).not.toContain('数据待确认');
 await zero.trigger('click');expect(wrapper.get('aside').text()).not.toContain('个原因');expect(wrapper.get('aside').text()).toContain('当天没有对应项目的有效工时贡献');
 await wrapper.get('tbody .pending-button').trigger('click');expect(wrapper.get('aside').text()).toContain('未排期任务0');expect(wrapper.get('aside').text()).toContain('缺少有效排期日期');wrapper.unmount();
});

it('周末加班显示预计工时和非工作日，不显示不足或超额',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,tasks:[{...task('overtime','100','18'),startDate:'2026-10-24',dueDate:'2026-10-24'}],records:[]});const wrapper=await mountPage();
 const cell=wrapper.get('button[aria-label="张三 2026-10-24 预计 18h 非工作日"]');expect(cell.text()).toContain('预计 18h');expect(cell.text()).not.toContain('超额');expect(cell.text()).not.toContain('缺');
 await cell.trigger('click');expect(wrapper.get('aside').text()).toContain('实际 0h ＋ 加班分配 18h');expect(wrapper.get('aside').text()).toContain('非工作日不受每日规定工时约束');
 expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('排期超额0 人日');wrapper.unmount();
});

it('截止周末的跨日任务显示周末预计值，截止周一则周末无工时',async()=>{
 mocks.fetch.mockResolvedValue({...snapshot,tasks:[{...task('cross','100','12'),startDate:'2026-10-23',dueDate:'2026-10-25'}],records:[]});
 const wrapper=await mountPage();expect(wrapper.find('button[aria-label="张三 2026-10-23 预计 8h 预计充足"]').exists()).toBe(true);expect(wrapper.find('button[aria-label="张三 2026-10-24 预计 2h 非工作日"]').exists()).toBe(true);expect(wrapper.find('button[aria-label="张三 2026-10-25 预计 2h 非工作日"]').exists()).toBe(true);wrapper.unmount();
 mocks.fetch.mockResolvedValue({...snapshot,tasks:[{...task('cross','100','12'),startDate:'2026-10-23',dueDate:'2026-10-26'}],records:[]});
 const next=await mountPage();expect(next.find('button[aria-label="张三 2026-10-24 非工作日"]').text()).toBe('非工作日');expect(next.find('button[aria-label="张三 2026-10-26 预计 4h 缺 4h"]').exists()).toBe(true);next.unmount();
});

describe('工作日单元格数值配色',()=>{
 const dates=['2026-10-13','2026-10-14','2026-10-15'];
 const cases=dates.flatMap(date=>[6,8,10].flatMap(hours=>[false,true].map(partial=>({date,hours,partial}))));
 it.each(cases)('$date 工时$hours 完整性异常$partial',async({date,hours,partial})=>{
  const past=date<'2026-10-14';
  const records=past?[{id:'spent',projectId:'p',entityType:'task' as const,entityId:'X',staffId:'100',spentDate:date,hours}]:[];
  const tasks=past?[]:[{...task('X','100',String(hours)),startDate:date,dueDate:date}];
  mocks.fetch.mockResolvedValue({tasks,records,status:partial?'partial':'complete',issues:partial?[{projectId:'p',staffId:'100',date,affects:'both',message:'数据未完整'}]:[]});
  const wrapper=await mountPage();const cell=wrapper.get('button[aria-label^="张三 '+date+' "]');
  expect(cell.classes()).toContain(hours>=8?'tone-enough':past?'tone-historical-short':'tone-forecast-short');
  expect(cell.text()).toContain((past?'实际 ':'预计 ')+hours+'h');
  if(partial){expect(cell.text()).toContain('当日数据待确认');if(hours<8){expect(cell.attributes('data-state')).toBe('unknown');expect(wrapper.get('[aria-label="工时汇总"]').text()).not.toContain('排期超额1 人日');}}
  else if(hours<8) expect(cell.text()).toContain('缺 2h');
  if(!past&&hours>8){expect(cell.attributes('data-state')).toBe('over');expect(cell.text()).toContain('排期超额 +2h');expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('排期超额1 人日');await wrapper.get('select[aria-label="异常筛选"]').setValue('over');expect(wrapper.find('button[aria-label^="张三 '+date+' "]').exists()).toBe(true);}
  wrapper.unmount();
 });
 it.each([7.499,7.5,7.501])('可配置7.5h目标边界：%s',async hours=>{
  mocks.fetch.mockResolvedValue({...snapshot,tasks:[],records:[{id:'spent',projectId:'p',entityType:'task',entityId:'X',staffId:'100',spentDate:'2026-10-13',hours}]});
  const wrapper=await mountPage();await useSettings().updateHours({...useSettings().settings.value.hours,dailyRequiredHours:7.5});await flushPromises();
  const cell=wrapper.get('button[aria-label^="张三 2026-10-13 "]');expect(cell.classes()).toContain(hours>=7.5?'tone-enough':'tone-historical-short');expect(cell.attributes('data-state')).toBe(hours>=7.5?'enough':'short');expect(cell.text()).toContain(hours<7.5?'实际 7.49h':'实际 7.5h');wrapper.unmount();
 });
 it('今天实际2h加分配6h为绿色，合计6h为橙色',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,tasks:[task('A','100','8'),task('B','200','6')],records:[{id:'today',projectId:'p',entityType:'task',entityId:'A',staffId:'100',spentDate:'2026-10-14',hours:2}]});
  const wrapper=await mountPage();const enough=wrapper.get('button[aria-label^="张三 2026-10-14 "]');expect(enough.classes()).toContain('tone-enough');expect(enough.text()).toContain('已填报 2h');await enough.trigger('click');expect(wrapper.get('aside').text()).toContain('实际 2h ＋ 剩余分配 6h');expect(wrapper.get('button[aria-label^="李四 2026-10-14 "]').classes()).toContain('tone-forecast-short');wrapper.unmount();
 });
 it('不完整数据不足按已知数值着色，确定不足统计仍不计入',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,tasks:[],records:snapshot.records,status:'partial',issues:[{projectId:'p',affects:'both',message:'接口未完整'}]});
  const wrapper=await mountPage();expect(wrapper.get('button[aria-label^="张三 2026-10-13 "]').classes()).toContain('tone-historical-short');expect(wrapper.get('button[aria-label^="张三 2026-10-14 "]').classes()).toContain('tone-forecast-short');expect(wrapper.get('button[aria-label^="张三 2026-10-15 "]').classes()).toContain('tone-forecast-short');expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('历史实际不足0 人 · 0 人日');expect(wrapper.get('[aria-label="工时汇总"]').text()).toContain('预计排期不足0 人 · 0 人日');wrapper.unmount();
 });
 it('非工作日与18h加班仍为灰色，图例解释四种颜色',async()=>{
  mocks.fetch.mockResolvedValue({...snapshot,tasks:[{...task('weekend','100','18'),startDate:'2026-10-24',dueDate:'2026-10-24'}],records:[]});
  const wrapper=await mountPage();expect(wrapper.get('button[aria-label="张三 2026-10-24 预计 18h 非工作日"]').classes()).toContain('tone-nonworking');expect(wrapper.get('button[aria-label="张三 2026-10-25 非工作日"]').classes()).toContain('tone-nonworking');expect(wrapper.get('.legend').text()).toContain('绿色：达到目标；红色：历史不足；橙色：今天／未来预计不足；灰色：非工作日');wrapper.unmount();
 });
});
