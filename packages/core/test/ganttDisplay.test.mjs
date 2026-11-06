import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGanttDisplayTasks, filterGanttDisplayTasks, ganttDisplayRows, calculateHours } from '../dist/index.js'
const range={start:'2026-10-01',end:'2026-10-31'}
const task=(id='1',extra={})=>({id,sourceType:'task',title:id,projectId:'p',projectName:'项目',projectColor:'#123456',assigneeIds:['a'],assigneeId:'a',assigneeName:'A',startDate:'2026-10-15',dueDate:'2026-10-16',status:'done',tapdUrl:'',...extra})
const member=(id,values)=>({member:{staffId:id,name:id},days:values.map(([date,key,hours])=>({date,contributions:[{taskKey:key,projectId:key.split(':')[0],actual:hours,allocated:0}]}))})
test('missing/partial/reversed dates span first to last actual day without changing sources',()=>{
 for(const dates of [{startDate:null,dueDate:null},{startDate:'2026-10-01',dueDate:null},{startDate:null,dueDate:'2026-10-30'},{startDate:'2026-10-20',dueDate:'2026-10-01'}]){
  const original=task('1',dates),before=JSON.stringify(original)
  const result=buildGanttDisplayTasks([original],[member('a',[['2026-10-09','p:task:1',4],['2026-10-12','p:task:1',4]])],range)[0]
  assert.equal(JSON.stringify(original),before);assert.equal(result.displaySpans.length,1)
  assert.deepEqual(result.displaySpans[0],{memberId:'a',memberName:'a',start:'2026-10-09',end:'2026-10-12',kind:'actual',actualDays:[{date:'2026-10-09',hours:4},{date:'2026-10-12',hours:4}]})
  assert.equal(filterGanttDisplayTasks([result],{start:'2026-10-10',end:'2026-10-11'})[0].displaySpans[0].start,'2026-10-09')
  const withoutHours=buildGanttDisplayTasks([original],[member('a',[]),member('b',[])],range)
  const pending=filterGanttDisplayTasks(withoutHours,range,['a'])
  assert.equal(pending.length,1);assert.equal(pending[0].displaySpans.length,0)
  assert.deepEqual(ganttDisplayRows(pending).map(row=>[row.memberId,row.spans.length]),[['a',0]])
  assert.equal(filterGanttDisplayTasks(withoutHours,range,['b']).length,0)
 }
})
test('transferred ownership uses individual actual days; owner keeps real dates plus outside days',()=>{
 const days=[['2026-10-09','p:task:1',1],['2026-10-15','p:task:1',2],['2026-10-19','p:task:1',3]]
 const result=buildGanttDisplayTasks([task()],[member('a',days),member('b',days)],range)[0]
 assert.deepEqual(result.displaySpans.filter(s=>s.memberId==='a').map(s=>[s.kind,s.start,s.end]),[['planned','2026-10-15','2026-10-16'],['actual','2026-10-09','2026-10-09'],['actual','2026-10-19','2026-10-19']])
 assert.equal(result.displaySpans.filter(s=>s.memberId==='b').length,3)
 assert.equal(ganttDisplayRows([result]).length,2)
 assert.equal(filterGanttDisplayTasks([result],range,['b'])[0].displaySpans.length,3)
})
test('distinct project/type IDs, missing metadata, nonpositive actuals and scope stay separate',()=>{
 const result=buildGanttDisplayTasks([], [member('a',[['2026-10-15','p:task:1',1],['2026-10-15','p:bug:1',2],['2026-10-15','q:bug:1',3],['2026-10-15','p:task:zero',0],['2026-11-01','p:task:outside',2]])],range,[{taskKey:'q:bug:1',projectName:'项目Q',projectColor:'#abcdef',warning:'资料未获取'}])
 assert.equal(result.length,3);assert.equal(new Set(ganttDisplayRows(result).map(r=>r.layoutTask.id)).size,3)
 assert.ok(result.every(t=>t.displayWarning&&t.tapdUrl.includes('/detail/1')))
 assert.equal(result.find(t=>t.projectId==='q').projectColor,'#abcdef')
 assert.equal(filterGanttDisplayTasks(result,range,['a'],['p']).length,2)
})
test('October regression actual totals remain 8.5, 8, 8, 4 and presentation never changes calculation inputs',()=>{
 const tasks=[task('t'),task('recycle',{assigneeIds:['b'],startDate:null,dueDate:null})]
 const records=[['a','2026-10-15','task','t',8],['a','2026-10-15','bug','b1',.5],['a','2026-10-19','task','t',1],['a','2026-10-19','bug','b2',6],['a','2026-10-19','bug','b3',1],['b','2026-10-09','task','t',4],['b','2026-10-09','task','recycle',4],['b','2026-10-10','task','recycle',4]].map(([staffId,spentDate,entityType,entityId,hours],i)=>({id:String(i),projectId:'p',staffId,spentDate,entityType,entityId,hours}))
 const input={snapshot:{tasks,records,issues:[],status:'complete'},members:[{staffId:'a',name:'A'},{staffId:'b',name:'B'}],settings:{dailyRequiredHours:8,exemptions:[],completedStates:[]},range,today:'2026-11-05',policy:'mcp'}
 const before=JSON.stringify(input),hours=calculateHours(input)
 buildGanttDisplayTasks(tasks,hours,range,[{taskKey:'p:bug:b1',task:task('b1',{sourceType:'bug',assigneeIds:['test']})}])
 assert.equal(JSON.stringify(input),before)
 const actual=(id,date)=>hours.find(m=>m.member.staffId===id).days.find(d=>d.date===date).actual
 assert.deepEqual([actual('a','2026-10-15'),actual('a','2026-10-19'),actual('b','2026-10-09'),actual('b','2026-10-10')],[8.5,8,8,4])
 assert.deepEqual(calculateHours(input),hours)
})
