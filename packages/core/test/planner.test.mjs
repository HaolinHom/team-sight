import test from 'node:test'
import assert from 'node:assert/strict'
import { planSchedule, normalizeSettings, createDefaultSettings, resolveMemberScope, calculateHours, checkRisks } from '../dist/index.js'
const range={start:'2026-11-02',end:'2026-11-06'}
const capacity=(values)=>Object.fromEntries(Object.entries(values).map(([id,hours])=>[id,hours.map((available,index)=>({date:'2026-11-0'+(index+2),target:8,actual:0,occupied:8-available,available}))]))
const task=(ref,hours)=>({ref,title:ref,hours,memberIds:['1'],storyId:'s'})
test('current identities use explicit default group membership',()=>{
 const old=normalizeSettings({schemaVersion:6,members:[{staffId:'1',name:'A'}],groups:[{id:'default',name:'默认',memberIds:['1']}]}).settings
 assert.equal(old.schemaVersion,6);assert.deepEqual(resolveMemberScope(old,{}).map(m=>m.staffId),['1'])
 const fresh=createDefaultSettings();fresh.members=[{staffId:'1',name:'A'}]
 assert.throws(()=>resolveMemberScope(fresh,{}),/TEAM_SCOPE_REQUIRED/)
 fresh.groups=[{id:'a',name:'A',memberIds:['1']},{id:'b',name:'B',memberIds:['1']}];fresh.defaultGroupId='a'
 assert.equal(resolveMemberScope(fresh,{groupIds:['a','b']}).length,1)
})
test('4+4 and 2+6 can occupy Monday and Wednesday without imposing story adjacency',()=>{
 for(const [hours,slots] of [[[4,4],[4,0,4,0,0]],[[2,6],[2,0,6,0,0]]]){
  const result=planSchedule({range,tasks:hours.map((h,i)=>task('t'+i,h)),capacities:capacity({'1':slots})})
  assert.equal(result.status,'feasible');assert.deepEqual(result.candidates[0].placements.map(p=>p.start),['2026-11-02','2026-11-04'])
 }
})
test('continuity and earliest profiles expose the tradeoff, strict capacity never overflows',()=>{
 const result=planSchedule({range,tasks:[task('t',8)],capacities:capacity({'1':[2,0,6,8,0]})})
 assert.equal(result.candidates[0].placements[0].start,'2026-11-05')
 assert.equal(result.candidates[1].placements[0].end,'2026-11-04')
 for(const candidate of result.candidates)for(const p of candidate.placements)for(const day of p.daily)assert.ok(day.hours<=capacity({'1':[2,0,6,8,0]})['1'].find(d=>d.date===day.date).available)
})
test('backward anchors, dependencies, explicit same-day and cycles are respected',()=>{
 const input={range,tasks:[task('a',4),task('b',4)],capacities:capacity({'1':[8,8,8,8,8]}),dependencies:[{before:'a',after:'b',source:'user'}]}
 const forward=planSchedule(input).candidates[0];assert.ok(forward.placements[0].end<forward.placements[1].start)
 const same=planSchedule({...input,dependencies:[{...input.dependencies[0],allowSameDay:true}]}).candidates[0];assert.equal(same.placements[0].start,same.placements[1].start)
 const back=planSchedule({...input,direction:'backward',tasks:[task('a',4)]}).status
 assert.equal(back,'needs_information')
 const anchor=planSchedule({...input,direction:'backward',tasks:[task('a',4)],dependencies:[{before:'a',after:'integration',source:'user'}],milestones:[{ref:'integration',date:'2026-11-06'}]})
 assert.equal(anchor.candidates[0].placements[0].end,'2026-11-05')
 assert.equal(planSchedule({...input,dependencies:[...input.dependencies,{before:'b',after:'a',source:'inferred'}]}).status,'infeasible')
})
test('incomplete data and bounded search never become false infeasibility',()=>{
 const input={range,tasks:[task('a',8)],capacities:capacity({'1':[8,8,8,8,8]})}
 assert.equal(planSchedule({...input,maxStates:1}).status,'search_incomplete')
 input.capacities['1'][0].unknown=true;assert.equal(planSchedule(input).status,'needs_information')
 assert.throws(()=>planSchedule({...input,range:{start:'2026-01-01',end:'2999-01-01'}}),/INVALID_RANGE/)
})
test('multi-person search assigns indivisible work units independently',()=>{
 const result=planSchedule({range,tasks:[{...task('a',8),memberIds:['1','2']},{...task('b',8),memberIds:['1','2']}],capacities:capacity({'1':[8,0,0,0,0],'2':[8,0,0,0,0]})})
 assert.equal(result.status,'feasible');assert.equal(new Set(result.candidates[0].placements.map(p=>p.memberId)).size,2)
})
test('MCP missing estimate uses zero, actuals survive missing dates and today gets shortage',()=>{
 const settings=createDefaultSettings(),members=[{staffId:'1',name:'A'}],today='2026-11-02'
 const source={tasks:[{id:'t',projectId:'p',sourceType:'task',title:'missing',assigneeIds:['1'],status:'open',startDate:null,dueDate:null}],records:[{id:'r',projectId:'p',entityType:'task',entityId:'t',staffId:'1',spentDate:today,hours:3}],issues:[],status:'complete'}
 const modern=calculateHours({snapshot:source,members,settings:settings.hours,range,today,})
 assert.equal(modern[0].days[0].actual,3);assert.equal(modern[0].days[0].state,'short')
 assert.ok(checkRisks(source,modern,settings,today).some(r=>r.date===today))
 assert.equal(checkRisks(source,modern,settings,today).some(r=>r.date===today&&r.code==='FORECAST_SHORT'),true)
 assert.equal(modern[0].pending.length,0)
})
