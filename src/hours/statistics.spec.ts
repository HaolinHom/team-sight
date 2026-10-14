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
  const row=calculate([invalid])[0]; expect(row.pending).toHaveLength(1);expect(row.days.some(day=>day.state==='unknown')).toBe(true);
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
