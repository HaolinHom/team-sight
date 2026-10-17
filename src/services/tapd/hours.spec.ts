import { createHoursCache } from './hoursCache';
import { describe, expect, it, vi } from 'vitest';
import { fetchHoursSnapshot, type HoursQuery } from './hours';
import type { TapdTransport } from './client';
import { createHoursSettings } from '@/hours/settings';

const query: HoursQuery={projects:[{id:'p',name:'项目',color:'#3b82f6',enabled:true}],members:[{staffId:'100',name:'甲'}],range:{start:'2026-10-12',end:'2026-10-14'},today:'2026-10-14',settings:createHoursSettings()};
const task={id:'X',name:'跨月任务',workspace_id:'p',owner:'甲_100;',begin:'2026-09-30',due:'2026-10-15',effort:'12',status:'progressing'};
const spent=(id:string,date:string,hours:string,extra:Record<string,unknown>={})=>({id,entity_type:'task',entity_id:'X',workspace_id:'p',owner:'乙_200',spentdate:date,timespent:hours,is_delete:'0',...extra});
function transport(options: { tasks?: Record<string,unknown>[]; actual?: Record<string,unknown>[]; cumulative?: Record<string,unknown>[]; fail?: (path:string,params:Record<string,string>)=>boolean }={}) {
 return vi.fn<TapdTransport>(async(path,params)=>{
  if(options.fail?.(path,params)) return {status:403,info:'permission denied',data:null};
  if(path==='/workspaces/users') return {status:1,info:'success',data:[{UserWorkspace:{user:'甲_100',name:'甲'}},{UserWorkspace:{user:'旧账号',name:'旧账号'}}]};
  const rows=path.startsWith('/tasks')?(options.tasks??[task]):path.startsWith('/bugs')?[]:params.entity_id?(options.cumulative??[spent('old','2026-09-30','3'),spent('current','2026-10-12','2')]):(options.actual??[spent('current','2026-10-12','2'),spent('outside','2026-10-13','8',{entity_id:'not-in-schedule',owner:'甲_100'})]);
  if(path.endsWith('/count')) return {status:1,info:'success',data:{count:rows.length}};
  const key=path==='/tasks'?'Task':path==='/bugs'?'Bug':'Timesheet';
  const offset=(Number(params.page)-1)*Number(params.limit);
  return {status:1,info:'success',data:rows.slice(offset,offset+Number(params.limit)).map(row=>({[key]:row}))};
 });
}

describe('工时数据接入',()=>{
 it('问题正文不固化项目名称，保留项目ID供页面解析',async()=>{
  const result=await fetchHoursSnapshot({...query,projects:[{...query.projects[0],name:'旧项目长名称'}]},transport({fail:path=>path==='/workspaces/users'}));
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues.every(issue=>issue.projectId==='p'&&!issue.message.includes('旧项目长名称'))).toBe(true);
 });
 it('独立读取展示区间和完整累计，跨查询去重，历史不依赖排期',async()=>{
  const mock=transport();const result=await fetchHoursSnapshot(query,mock);
  expect(result.status).toBe('complete'); expect(result.records).toHaveLength(3);
  expect(result.records.find(record=>record.id==='outside')).toMatchObject({entityId:'not-in-schedule',staffId:'100',hours:8});
  expect(result.records.find(record=>record.id==='old')?.spentDate).toBe('2026-09-30');
  expect(mock.mock.calls.some(([path,params])=>path==='/timesheets'&&params.entity_id==='X'&&params.spentdate==='1970-01-01~2026-10-14'&&!params.owner)).toBe(true);
  expect(mock.mock.calls.some(([path,params])=>path==='/tasks'&&params.owner==='甲_100'&&!params.begin&&!params.due)).toBe(true);
 });
 it('按单成员读取缺日期、逾期工作项，并去重多人查询结果',async()=>{
  const tasks=[{...task,id:'missing',begin:null,due:null},{...task,id:'overdue',due:'2026-10-09'}];
  const result=await fetchHoursSnapshot(query,transport({tasks,cumulative:[]}));expect(result.tasks.map(item=>item.id)).toEqual(['missing','overdue']);
 });
 it('已结束任务不发累计请求，自定义终态生效',async()=>{
  const mock=transport({tasks:[{...task,status:'已验收'}]});
  await fetchHoursSnapshot({...query,settings:{...query.settings,completedStates:[{projectId:'p',type:'task',values:['已验收']}]}},mock);
  expect(mock.mock.calls.some(([,params])=>params.entity_id)).toBe(false);
 });
 it('仅任务缺陷统计，删除记录忽略，旧账号花费保留扣总量',async()=>{
  const mock=transport({tasks:[],actual:[spent('deleted','2026-10-12','8',{is_delete:'1'}),spent('story','2026-10-12','8',{entity_type:'story'}),spent('legacy','2026-10-12','3',{owner:'旧账号'})]});
  const result=await fetchHoursSnapshot(query,mock);expect(result.records).toHaveLength(1);expect(result.records[0].staffId).toBe('user:旧账号');expect(result.status).toBe('complete');
 });
 it.each([{timespent:null},{timespent:'oops'},{timespent:'-2'},{spentdate:'2026-02-30'},{owner:'无法映射'}])('无效记录标记待确认：%j',async extra=>{
  const result=await fetchHoursSnapshot(query,transport({tasks:[],actual:[spent('bad','2026-10-12','8',extra)]}));
  expect(result.status).toBe('partial');expect(result.records).toHaveLength(0);expect(result.issues[0].affects).toBe('actual');
 });
 it('实际接口失败保留工作项，但实际维度待确认',async()=>{
  const result=await fetchHoursSnapshot(query,transport({fail:(path,params)=>path.startsWith('/timesheets')&&!params.entity_id}));
  expect(result.status).toBe('partial');expect(result.tasks).toHaveLength(1);expect(result.issues.some(issue=>issue.affects==='actual')).toBe(true);
 });
 it('累计失败按任务标记，不能把剩余视为完整',async()=>{
  const result=await fetchHoursSnapshot(query,transport({fail:(path,params)=>path.startsWith('/timesheets')&&!!params.entity_id}));
  expect(result.issues.some(issue=>issue.taskKey==='p:task:X'&&issue.affects==='forecast')).toBe(true);
 });
 it('成员目录失败保留已知实际，预计待确认',async()=>{
  const result=await fetchHoursSnapshot(query,transport({fail:path=>path==='/workspaces/users'}));
  expect(result.status).toBe('partial');expect(result.records.length).toBeGreaterThan(0);expect(result.issues[0].affects).toBe('forecast');
 });
 it('全部接口失败返回failed，不伪装为空结果成功',async()=>{
  const result=await fetchHoursSnapshot(query,transport({fail:()=>true}));expect(result.status).toBe('failed');
 });
 it('按200条分页读取，count失败仍按短页收敛',async()=>{
  const actual=Array.from({length:201},(_,i)=>spent(String(i),'2026-10-12','1',{owner:'甲_100'}));
  const mock=transport({tasks:[],actual,fail:path=>path==='/timesheets/count'});
  const result=await fetchHoursSnapshot(query,mock);expect(result.records).toHaveLength(201);expect(result.status).toBe('complete');
  expect(mock.mock.calls.some(([path,params])=>path==='/timesheets'&&params.page==='2')).toBe(true);
 });
 it('分页触顶保留已有数据并标记不完整',async()=>{
  const mock=transport({tasks:[]});
  const wrapped:TapdTransport=async(path,params)=>{
   if(path==='/timesheets/count') return {status:1,info:'success',data:{count:10001}};
   if(path==='/timesheets') return {status:1,info:'success',data:Array.from({length:200},(_,i)=>({Timesheet:spent(String((Number(params.page)-1)*200+i),'2026-10-12','1')}))};
   return mock(path,params);
  };
  const result=await fetchHoursSnapshot(query,wrapped);expect(result.records).toHaveLength(10000);expect(result.status).toBe('partial');expect(result.issues[0].message).toContain('50 页');
 });
});

it('无法识别全部负责人时不假装均分份额完整',async()=>{const result=await fetchHoursSnapshot(query,transport({tasks:[{...task,owner:'甲_100;旧账号;'}]}));expect(result.issues.some(issue=>issue.taskKey==='p:task:X'&&issue.message.includes('份额待确认'))).toBe(true);});
it('累计接口关联筛选不匹配时标记该任务未知',async()=>{const result=await fetchHoursSnapshot(query,transport({cumulative:[spent('wrong','2026-10-12','8',{entity_id:'other'})]}));expect(result.issues.some(issue=>issue.taskKey==='p:task:X'&&issue.message.includes('筛选不匹配'))).toBe(true);});
it('服务端重复返回同一页不能误判完整',async()=>{const mock=transport({tasks:[]});const wrapped:TapdTransport=async(path,params)=>{if(path==='/timesheets/count')return {status:1,info:'success',data:{count:400}};if(path==='/timesheets')return {status:1,info:'success',data:Array.from({length:200},(_,i)=>({Timesheet:spent(String(i),'2026-10-12','1')}))};return mock(path,params);};const result=await fetchHoursSnapshot(query,wrapped);expect(result.status).toBe('partial');expect(result.records).toHaveLength(200);expect(result.issues[0].message).toContain('重复记录');});

describe('缓存及取消',()=>{
 it('切换日期只重取实际查询，手动刷新绕过所有缓存',async()=>{
  const cache=createHoursCache(),mock=transport();const first=await fetchHoursSnapshot(query,mock,{cache});const count=mock.mock.calls.length;
  const same=await fetchHoursSnapshot(query,mock,{cache});expect(mock.mock.calls).toHaveLength(count);expect(same.metrics?.requests).toBe(0);expect(same.fetchedAt).toBe(first.fetchedAt);
  await fetchHoursSnapshot({...query,range:{start:'2026-10-01',end:'2026-10-31'}},mock,{cache});expect(mock.mock.calls).toHaveLength(count+1);
  await fetchHoursSnapshot(query,mock,{cache,force:true});expect(mock.mock.calls).toHaveLength(count*2+1);
 });
 it('凭据上下文改变时不复用旧查询',async()=>{const cache=createHoursCache(),mock=transport();await fetchHoursSnapshot(query,mock,{cache});const count=mock.mock.calls.length;await fetchHoursSnapshot({...query,credentialRevision:1},mock,{cache});expect(mock.mock.calls).toHaveLength(count*2);});
 it('部分失败不缓存失败查询',async()=>{const cache=createHoursCache(),mock=transport({fail:(path,params)=>path==='/timesheets'&&!!params.entity_id});await fetchHoursSnapshot(query,mock,{cache});const count=mock.mock.calls.length;await fetchHoursSnapshot(query,mock,{cache});expect(mock.mock.calls.length).toBeGreaterThan(count);});
 it('取消后停止累计队列，不把取消伪装成业务失败',async()=>{
  const controller=new AbortController(),base=transport();const mock:TapdTransport=async(path,params)=>{const result=await base(path,params);if(path==='/tasks')controller.abort();return result;};
  await expect(fetchHoursSnapshot(query,mock,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(base.mock.calls.some(([,params])=>params.entity_id)).toBe(false);
 });
});
