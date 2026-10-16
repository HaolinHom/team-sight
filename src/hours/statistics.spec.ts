import { describe, expect, it } from 'vitest';
import { calculateHours, formatHours } from './statistics';
import { createHoursSettings, shanghaiToday } from './settings';
import type { HoursSnapshot, TimesheetRecord } from '@/types/hours';
import type { ScheduleTask } from '@/types/schedule';

const member = {staffId:'100',name:'张三'};
function task(id: string, start: string | null, due: string | null, effort: string | undefined, extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {id,sourceType:'task',title:id,projectId:'p',projectName:'项目',projectColor:'#3b82f6',assigneeId:'100',assigneeName:'张三',assigneeIds:['100'],startDate:start,dueDate:due,effort,status:'open',tapdUrl:'https://www.tapd.cn',...extra};
}
function record(id:string,entityId:string,staffId:string,date:string,hours:number): TimesheetRecord { return {id,projectId:'p',entityType:'task',entityId,staffId,spentDate:date,hours}; }
function calculate(tasks:ScheduleTask[], records:TimesheetRecord[] = [], extra: Partial<Parameters<typeof calculateHours>[0]> = {}) {
 const snapshot:HoursSnapshot={tasks,records,issues:[],status:'complete'};
 return calculateHours({snapshot,members:[member],settings:createHoursSettings(),today:'2026-10-12',range:{start:'2026-10-12',end:'2026-10-14'},...extra});
}
const example = [task('A','2026-10-12','2026-10-12','4'),task('B','2026-10-12','2026-10-12','2'),task('C','2026-10-12','2026-10-13','6'),task('D','2026-10-13','2026-10-13','2'),task('E','2026-10-13','2026-10-14','4'),task('F','2026-10-14','2026-10-14','6')];

describe('每日实际与预计工时',()=>{
 it('按输入成员顺序返回，不按不足天数排序，重排不改变统计',()=>{
  const members = [member, {staffId:'200',name:'李四'}, {staffId:'300',name:'李四'}];
  const tasks = [task('enough','2026-10-12','2026-10-12','8')];
  const records = [record('past','X','100','2026-10-09',8)];
  const options = {members,today:'2026-10-12',range:{start:'2026-10-09',end:'2026-10-12'}};
  const original = calculate(tasks, records, options);
  expect(original.map(row=>row.member.staffId)).toEqual(['100','200','300']);
  expect(original[0].historicalShortDays).toBeLessThan(original[1].historicalShortDays);
  expect(original[0].forecastShortDays).toBeLessThan(original[1].forecastShortDays);
  const reordered = calculate(tasks, records, {...options,members:[members[2],members[0],members[1]]});
  expect(reordered.map(row=>row.member.staffId)).toEqual(['300','100','200']);
  for (const row of reordered) expect(row).toEqual(original.find(item=>item.member.staffId===row.member.staffId));
 });

 it('按示例补齐为 8/8/8，并且跨日任务保留余量',()=>{
  const row=calculate(example)[0]; expect(row.days.map(day=>day.total)).toEqual([8,8,8]);
  expect(row.days.map(day=>day.contributions.find(item=>item.taskKey==='p:task:C')?.allocated??0)).toEqual([2,4,0]);
  expect(row.days.map(day=>day.contributions.find(item=>item.taskKey==='p:task:E')?.allocated??0)).toEqual([0,2,2]);
 });
 it('改变展示窗口不改变同日分配',()=>{
  expect(calculate(example,[],{range:{start:'2026-10-13',end:'2026-10-13'}})[0].days[0]).toEqual(calculate(example)[0].days[1]);
 });
 it('单日任务先占容量，跨日任务截止日保留超额',()=>{
  const row=calculate([task('span','2026-10-12','2026-10-13','12'),task('fixed','2026-10-13','2026-10-13','8')])[0];
  expect(row.days.slice(0,2).map(day=>day.total)).toEqual([8,12]);expect(row.days[1].state).toBe('over');
 });
 it('今天实际加剩余，累计花费涵盖上月且不重复扣减',()=>{
  const logs=[record('old','X','100','2026-09-30',3),record('today','X','100','2026-10-12',2)];
  const row=calculate([task('X','2026-09-30','2026-10-13','12')],logs)[0];
  expect(row.days.slice(0,2).map(day=>day.total)).toEqual([8,1]); expect(row.days[0].actual).toBe(2);expect(row.days[0].allocated).toBe(6);
 });
 it('过去只看花费，已结束任务不产生剩余，花费归填报人',()=>{
  const ended=task('X','2026-10-12','2026-10-14','20',{status:'done',assigneeIds:['200']});
  const row=calculate([ended],[record('spent','X','100','2026-10-12',7.5)],{today:'2026-10-13'})[0];
  expect(row.days[0]).toMatchObject({actual:7.5,allocated:0,deficit:.5,basis:'actual',state:'short'});
  expect(row.days[1].allocated).toBe(0);
 });
 it('没有填报为0，自定义结束状态忽略剩余',()=>{
  const settings=createHoursSettings();settings.completedStates=[{projectId:'p',type:'task',values:['已验收']}];
  expect(calculate([task('X','2026-10-12','2026-10-12','8',{status:'已验收'})],[],{settings})[0].days[0].total).toBe(0);
 });
 it('逾期未结束单列待安排，已结束逾期任务不保留剩余',()=>{
  const row=calculate([task('X','2026-10-09','2026-10-09','8'),task('Y','2026-10-09','2026-10-09','8',{status:'closed'})])[0];
  expect(row.pending).toHaveLength(1);expect(row.pending[0]).toMatchObject({hours:8,overdue:true});expect(row.days[0].total).toBe(0);
 });
 it('重复和未来填报不重复计算累计量',()=>{
  const spent=record('r','X','100','2026-10-12',2);
  const row=calculate([task('X','2026-10-12','2026-10-12','8')],[spent,spent,record('future','X','100','2026-10-15',8)])[0];
  expect(row.days[0]).toMatchObject({actual:2,allocated:6,total:8});
 });
 it('未达到目标的精度不被展示为达标',()=>{expect(formatHours(7.999)).toBe('7.99');expect(calculate([], [record('r','X','100','2026-10-12',7.999)])[0].days[0].state).toBe('short');});
});

describe('多人任务份额',()=>{
 it('超出份额者退出，剩余2h全部给另一人',()=>{
  const rows=calculate([task('X','2026-10-12','2026-10-12','8',{assigneeIds:['100','200']})],[record('spent','X','100','2026-10-09',6)],{members:[member,{staffId:'200',name:'乙'}]});
  expect(rows.find(row=>row.member.staffId==='100')?.days[0].allocated).toBe(0);
  expect(rows.find(row=>row.member.staffId==='200')?.days[0].allocated).toBe(2);
 });
 it('三人任务剩余5h按3:4分配，而不是新增工时',()=>{
  const rows=calculate([task('X','2026-10-12','2026-10-12','12',{assigneeIds:['100','200','300']})],[record('a','X','100','2026-10-09',6),record('b','X','200','2026-10-09',1)],{members:[member,{staffId:'200',name:'乙'},{staffId:'300',name:'丙'}]});
  expect(rows.find(row=>row.member.staffId==='200')!.days[0].allocated).toBeCloseTo(15/7);
  expect(rows.find(row=>row.member.staffId==='300')!.days[0].allocated).toBeCloseTo(20/7);
  expect(rows.reduce((sum,row)=>sum+row.days[0].allocated,0)).toBeCloseTo(5);
 });
 it('未展示负责人也占份额，离任负责人花费仍扣总量',()=>{
  const row=calculate([task('X','2026-10-12','2026-10-12','8',{assigneeIds:['100','200']})],[record('old','X','300','2026-10-09',2)])[0];
  expect(row.days[0].allocated).toBe(3);
 });
});

describe('日历与完整性',()=>{
 it('目标改为7.5后重新分配并判断缺口',()=>{
  const settings={...createHoursSettings(),dailyRequiredHours:7.5};
  expect(calculate([task('X','2026-10-12','2026-10-13','12')],[],{settings})[0].days.slice(0,2).map(day=>day.total)).toEqual([7.5,4.5]);
 });
 it('周末不安排，调休可安排，豁免仍保留实际',()=>{
  const settings=createHoursSettings(); settings.calendarOverrides=[{date:'2026-10-10',working:true,note:'调休'}];settings.exemptions=[{staffId:'100',date:'2026-10-12',note:'请假'}];
  const row=calculate([task('X','2026-10-10','2026-10-12','8')],[record('actual','X','100','2026-10-12',2)],{today:'2026-10-10',range:{start:'2026-10-10',end:'2026-10-12'},settings})[0];
  expect(row.days.map(day=>day.allocated)).toEqual([8,0,0]);expect(row.days[2].state).toBe('exempt');
  expect(calculate([], [record('actual','X','100','2026-10-12',2)],{settings})[0].days[0].actual).toBe(2);
 });
 it.each([task('missing','2026-10-12','2026-10-14',undefined),task('date',null,null,'8'),task('reverse','2026-10-14','2026-10-12','8')])('无效任务列为待确认，不伪造预计不足：$id',invalid=>{
  const row=calculate([invalid])[0]; expect(row.pending).toHaveLength(1);expect(row.days.some(day=>day.state==='unknown')).toBe(invalid.id === 'missing');
 });
 it('历史接口不完整不能将未知数据当成零',()=>{
  const row=calculate([],[],{today:'2026-10-13',snapshot:{tasks:[],records:[],status:'partial',issues:[{projectId:'p',affects:'actual',message:'未拉全'}]}})[0];
  expect(row.days[0].state).toBe('unknown');expect(row.historicalShortDays).toBe(0);expect(row.days[2].state).toBe('short');
 });
 it('累计花费失败不使用已知部分计算剩余',()=>{
  const t=task('X','2026-10-12','2026-10-14','8');
  const row=calculate([],[],{snapshot:{tasks:[t],records:[],status:'partial',issues:[{projectId:'p',taskKey:'p:task:X',affects:'forecast',message:'累计失败'}]}})[0];
  expect(row.days[0].state).toBe('unknown');expect(row.days[0].allocated).toBe(0);expect(row.pending[0].hours).toBeNull();
 });
 it('北京时间跨日独立于执行主机时区',()=>{expect(shanghaiToday(new Date('2026-10-13T16:01:00Z'))).toBe('2026-10-14');});
});

it('逾期累计失败的剩余量也必须待确认',()=>{ const t=task('X','2026-10-09','2026-10-09','8');const row=calculate([],[],{snapshot:{tasks:[t],records:[],status:'partial',issues:[{projectId:'p',taskKey:'p:task:X',affects:'forecast',message:'累计失败'}]}})[0];expect(row.pending[0]).toMatchObject({hours:null,overdue:true}); });

describe('达标结论与完整性独立', () => {
 const issue = { projectId: 'p', affects: 'both' as const, message: '部分记录未完整' };
 it('实际达到目标仍达标，并保留待确认原因', () => {
  const records = [record('r', 'X', '100', '2026-10-12', 8)];
  const day = calculate([], [], { today: '2026-10-13', snapshot: { tasks: [], records, status: 'partial', issues: [issue] } })[0].days[0];
  expect(day).toMatchObject({ actual: 8, total: 8, state: 'enough', reasons: [issue.message] });
 });
 it('实际2h加分配6h达到目标仍预计充足', () => {
  const tasks = [task('X', '2026-10-12', '2026-10-12', '8')];
  const records = [record('r', 'X', '100', '2026-10-12', 2)];
  const day = calculate([], [], { snapshot: { tasks, records, status: 'partial', issues: [issue] } })[0].days[0];
  expect(day).toMatchObject({ actual: 2, allocated: 6, total: 8, state: 'enough', reasons: [issue.message] });
 });
 it('未知任务不覆盖已知8h排期的充足结论', () => {
  const row = calculate([task('X','2026-10-12','2026-10-12','8'), task('missing','2026-10-12','2026-10-14',undefined)])[0];
  expect(row.days[0].state).toBe('enough'); expect(row.days[0].reasons).toHaveLength(1);
  expect(row.days[1].state).toBe('unknown'); expect(row.forecastShortDays).toBe(0);
 });
 it('已知超额保留超额提示，未知不足不计入不足天数', () => {
  const day = calculate([], [], { snapshot: { tasks: [task('X','2026-10-12','2026-10-12','10')], records: [], status: 'partial', issues: [issue] } })[0].days[0];
  expect(day.state).toBe('over'); expect(day.reasons).toEqual([issue.message]);
 });
});

describe('休息日完整性范围', () => {
 const range = { start: '2026-10-24', end: '2026-10-26' };
 it('缺预估及缺日期任务不污染周末，工作日仍待确认', () => {
  const row = calculate([task('missing','2026-10-24','2026-10-26',undefined)], [], { today: '2026-10-23', range })[0];
  expect(row.days.slice(0,2).map(day => ({ state: day.state, reasons: day.reasons }))).toEqual([{ state: 'exempt', reasons: [] },{ state: 'exempt', reasons: [] }]);
  expect(row.days[2].state).toBe('unknown'); expect(row.pending).toHaveLength(1);
 });
 it('未来休息日忽略接口异常，调休工作日恢复待确认', () => {
  const snapshot: HoursSnapshot = { tasks: [], records: [], status: 'partial', issues: [{ projectId:'p', affects:'both', message:'接口未完整' }] };
  const settings = createHoursSettings(); settings.calendarOverrides=[{ date:'2026-10-24', working:true, note:'调休' }];
  const row = calculate([], [], { today:'2026-10-23', range, snapshot, settings })[0];
  expect(row.days[0].state).toBe('unknown'); expect(row.days[1].reasons).toEqual([]);
 });
 it('成员豁免日排除预测异常，有效实际仍保留', () => {
  const settings = createHoursSettings(); settings.exemptions=[{ staffId:'100', date:'2026-10-12', note:'请假' }];
  const row = calculate([task('missing',null,null,undefined)], [record('r','X','100','2026-10-12',2)], { settings })[0];
  expect(row.days[0]).toMatchObject({ state:'exempt', actual:2, allocated:0, reasons:[] });
 });
 it('过去或今天休息日仍保留实际记录不完整提示', () => {
  const snapshot: HoursSnapshot = { tasks: [], records:[record('r','X','100','2026-10-24',2)], status:'partial', issues:[{ projectId:'p', affects:'actual', message:'记录未完整' },{ projectId:'p', affects:'forecast', message:'排期未完整' }] };
  const row = calculate([],[],{ today:'2026-10-25',range,snapshot })[0];
  expect(row.days[0]).toMatchObject({ state:'exempt',actual:2,reasons:['记录未完整'] });
  expect(row.days[1].reasons).toEqual(['记录未完整']);
 });
});

describe('异常仅影响可定位的日期',()=>{
 it('四项无法定位日期的任务只列待安排，不扩散到后续0h日期',()=>{
  const tasks=[task('valid','2026-10-12','2026-10-12','4.5'),task('missing-start',null,'2026-10-14','8'),task('missing-end','2026-10-12',null,'8'),task('missing-both',null,null,'8'),task('reverse','2026-10-14','2026-10-12','8')];
  const row=calculate(tasks)[0];expect(row.pending).toHaveLength(4);expect(row.days.map(day=>day.total)).toEqual([4.5,0,0]);expect(row.days.map(day=>day.reasons)).toEqual([[],[],[]]);expect(row.days.map(day=>day.state)).toEqual(['short','short','short']);
 });
 it('四项有完整排期但缺预估的任务只影响自身区间，0h也可能待确认',()=>{
  const tasks=Array.from({length:4},(_,i)=>task('unknown'+i,'2026-10-12','2026-10-13',undefined));
  const row=calculate(tasks)[0];expect(row.days.map(day=>day.reasons.length)).toEqual([4,4,0]);expect(row.days.map(day=>day.state)).toEqual(['unknown','unknown','short']);expect(row.days[0].reasons[0]).toContain('缺少有效预估工时');
 });
 it('接口失败仍影响相应日期，不能因已知0h而误判确定不足',()=>{
  const snapshot:HoursSnapshot={tasks:[],records:[],status:'partial',issues:[{projectId:'p',staffId:'100',date:'2026-10-13',affects:'forecast',message:'接口读取失败'}]};
  const row=calculate([],[],{snapshot})[0];expect(row.days.map(day=>day.state)).toEqual(['short','unknown','short']);
 });
});

describe('非工作日按需加班',()=>{
 const range={start:'2026-10-23',end:'2026-10-26'};
 it('单日周末18h全量分配，不限制8h且不判断不足或超额',()=>{
  const row=calculate([task('overtime','2026-10-24','2026-10-24','18')],[],{today:'2026-10-23',range})[0];
  expect(row.days[1]).toMatchObject({allocated:18,total:18,target:0,deficit:0,state:'exempt'});expect(row.pending).toHaveLength(0);
 });
 it('纯周末多日均分，与规定工时及展示范围无关',()=>{
  const tasks=[task('overtime','2026-10-24','2026-10-25','20')];
  const settings={...createHoursSettings(),dailyRequiredHours:7.5};
  const row=calculate(tasks,[],{today:'2026-10-23',range,settings})[0];expect(row.days.slice(1,3).map(day=>day.total)).toEqual([10,10]);
  expect(calculate(tasks,[],{today:'2026-10-23',range:{start:'2026-10-25',end:'2026-10-25'},settings})[0].days[0]).toEqual(row.days[2]);
 });
 it('截止周末时工作日先8h，余量在周末均分',()=>{
  const row=calculate([task('cross','2026-10-23','2026-10-25','12')],[],{today:'2026-10-23',range})[0];expect(row.days.map(day=>day.allocated)).toEqual([8,2,2,0]);
 });
 it('今天周末实际加剩余不重复，已结束任务只计实际',()=>{
  const row=calculate([task('live','2026-10-24','2026-10-24','12'),task('done','2026-10-24','2026-10-24','10',{status:'done'})],[record('r','live','100','2026-10-24',2),record('done','done','100','2026-10-24',3)],{today:'2026-10-24',range})[0];
  expect(row.days[1]).toMatchObject({actual:5,allocated:10,total:15,target:0,state:'exempt'});
 });
 it('节假日可加班，个人请假不安排，调休工作日按目标判断',()=>{
  const settings=createHoursSettings();settings.calendarOverrides=[{date:'2026-10-23',working:false,note:'节假日'},{date:'2026-10-24',working:true,note:'调休'}];settings.exemptions=[{date:'2026-10-25',staffId:'100',note:'请假'}];
  const row=calculate([task('holiday','2026-10-23','2026-10-23','2'),task('working','2026-10-24','2026-10-24','10'),task('leave','2026-10-25','2026-10-25','4')],[],{today:'2026-10-23',range,settings})[0];
  expect(row.days[0]).toMatchObject({allocated:2,state:'exempt'});expect(row.days[1]).toMatchObject({allocated:10,state:'over'});expect(row.days[2].allocated).toBe(0);expect(row.pending).toHaveLength(1);
 });
 it('明确周末加班但缺预估时保留当日原因，不影响其他休息日',()=>{
  const row=calculate([task('missing','2026-10-24','2026-10-24',undefined)],[],{today:'2026-10-23',range})[0];expect(row.days[1].reasons).toHaveLength(1);expect(row.days[2].reasons).toEqual([]);
 });
});

describe('截止日决定末尾周末加班',()=>{
 const range={start:'2026-10-23',end:'2026-10-26'};
 it('周五到周一12h跳过周末，得到8/0/0/4',()=>{
  const row=calculate([task('cross','2026-10-23','2026-10-26','12')],[],{today:'2026-10-23',range})[0];expect(row.days.map(day=>day.allocated)).toEqual([8,0,0,4]);
 });
 it('仅周六周日12h仍均分6/6',()=>{
  const row=calculate([task('cross','2026-10-24','2026-10-25','12')],[],{today:'2026-10-23',range})[0];expect(row.days.map(day=>day.allocated)).toEqual([0,6,6,0]);
 });
 it('周五到周六12h得到8/4，工作日容量被固定任务占满则余量全部周末',()=>{
  const cross=task('cross','2026-10-23','2026-10-24','12');
  expect(calculate([cross],[],{today:'2026-10-23',range})[0].days.map(day=>day.allocated)).toEqual([8,4,0,0]);
  expect(calculate([cross,task('fixed','2026-10-23','2026-10-23','8')],[],{today:'2026-10-23',range})[0].days.map(day=>day.allocated)).toEqual([8,12,0,0]);
 });
 it('截止日在工作日的跨周末任务不产生周末异常，单格查询保持一致',()=>{
  const tasks=[task('cross','2026-10-23','2026-10-26','12'),task('missing','2026-10-23','2026-10-26',undefined)];
  const row=calculate(tasks,[],{today:'2026-10-23',range})[0];expect(row.days[1].reasons).toEqual([]);expect(row.days[2].reasons).toEqual([]);
  expect(calculate(tasks,[],{today:'2026-10-23',range:{start:'2026-10-26',end:'2026-10-26'}})[0].days[0]).toEqual(row.days[3]);
 });
 it('长任务只用截止日前末尾连续休息日，中间周末不自动分配',()=>{
  const tasks=[task('cross','2026-10-16','2026-10-25','60')];
  const row=calculate(tasks,[],{today:'2026-10-16',range:{start:'2026-10-16',end:'2026-10-25'}})[0];
  expect(row.days.map(day=>day.allocated)).toEqual([8,0,0,8,8,8,8,8,6,6]);
 });
});

it('工作日截止的未知任务不污染其他任务的周末加班',()=>{
 const row=calculate([task('live','2026-10-23','2026-10-25','12'),task('unknown','2026-10-23','2026-10-26',undefined)],[],{today:'2026-10-23',range:{start:'2026-10-23',end:'2026-10-26'}})[0];
 expect(row.days[0].reasons).toHaveLength(1);expect(row.days[1].reasons).toEqual([]);expect(row.days[2].reasons).toEqual([]);
});
