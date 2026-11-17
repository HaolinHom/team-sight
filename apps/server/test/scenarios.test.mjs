import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../dist/storage.js'
import { createBusiness } from '../dist/business.js'
import { createScenarios,parseReference } from '../dist/scenarios.js'
import { startServer } from '../dist/server.js'
import { TapdError } from '@teamsight/tapd'
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const today='2026-11-02',range={start:today,end:'2026-11-06',analysisDate:today}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'teamsight-scenes-')),secrets=new Map(),calls=[],rows=new Map(),records=[]
 const vault={put:(id,value)=>secrets.set(id,value),get:id=>secrets.get(id)??null,remove:id=>secrets.delete(id)}
 const projects=[{id:'1',name:'One',enabled:true,color:'#167d7f'},{id:'2',name:'Two',enabled:true,color:'#478fd0'}]
 const directory=['A_100','B_200','QA_300','legacy-account'].map(user=>({user,name:user.replace(/_\d+$/,'')}))
 rows.set('story:101',{id:'101',workspace_id:'1',name:'Requirement',description:'<p>Details</p><img src="https://www.tapd.cn/image.png">',status:'open'})
 rows.set('task:201',{id:'201',workspace_id:'1',name:'Development',owner:'A_100',story_id:'101',begin:today,due:today,effort:'8',status:'open',created:today+' 10:00:00',modified:'v1'})
 rows.set('task:202',{id:'202',workspace_id:'1',name:'验收',owner:'QA_300',story_id:'101',begin:'2026-11-04',due:'2026-11-04',effort:'8',status:'open'})
 rows.set('task:203',{id:'203',workspace_id:'1',name:'测试回归',owner:'B_200',story_id:'101',begin:'2026-11-05',due:'2026-11-05',effort:'4',status:'open'})
 let fault='',serial=900,writes=0
 const ok=data=>({status:1,info:'success',httpStatus:200,data})
 const filtered=(path,params)=>[...rows.entries()].filter(([key,row])=>key.startsWith(path==='/stories'?'story:':path==='/tasks'?'task:':'bug:')&&String(row.workspace_id)===params.workspace_id&&(!params.id||String(row.id)===params.id)&&(!params.owner||String(row.owner??'').split(';').includes(params.owner))&&(!params.current_owner||row.current_owner===params.current_owner)&&(!params.story_id||String(row.story_id)===params.story_id)).map(([,row])=>row)
 const transport=async(path,params,signal,request)=>{
  calls.push({path,params:{...params},method:request?.method??'GET'})
  if(request?.method==='POST'){
   if(fault==='inspect'){const receipt=JSON.parse(store.db.prepare("SELECT value FROM operations WHERE status='in_flight'").get().value);assert.ok(receipt.batchId);assert.equal(receipt.itemKey,'existing')}
   writes++;if(fault==='reject'&&params.name==='reject')throw new TapdError('rejected',422,422,0)
   const type=path==='/tasks'?'task':'story',id=params.id??String(++serial),value={...(rows.get(type+':'+id)??{}),...params,id,status:'open',modified:String(serial)}
   rows.set(type+':'+id,value)
   if(fault==='lost')throw new Error('connection lost after applying')
   return ok({[type==='task'?'Task':'Story']:value})
  }
  if(path==='/users/info')return ok({id:'999',nick:'A_100',name:'A_100'})
  if(path==='/workspaces/user_participant_projects')return ok(projects.map(project=>({Workspace:project})))
  if(path==='/workspaces/users')return fault==='directory'?ok({bad:true}):ok(directory.map(user=>({UserWorkspace:user})))
  if(path==='/tasks/custom_fields_settings')return ok([])
  if(path==='/stories/get_fields_info')return ok({})
  if(path==='/attachments')return ok([{Attachment:{id:'at1',entry_id:'101',workspace_id:'1',filename:'requirement.pdf'}}])
  if(path==='/task_changes')return ok([{WorkitemChange:{id:'tc1',workspace_id:'1',task_id:params.task_id.split(',')[0],created:today+' 11:00:00',changes:'[]'}}])
  if(path==='/story_changes')return ok([{WorkitemChange:{id:'ch1',story_id:'101',created:today+' 10:00:00',change_summary:'状态变更',changes:'status',field_changes:{status:{old_value:'open',new_value:'developing'}}}}])
  if(path==='/timesheets'||path==='/timesheets/count'){
   let values=records.filter(row=>row.workspace_id===params.workspace_id&&(!params.entity_id||row.entity_id===params.entity_id))
   if(params.spentdate){const [start,end]=params.spentdate.split('~');values=values.filter(row=>row.spentdate>=start&&row.spentdate<=end)}
   if(path.endsWith('count'))return ok({count:values.length})
   return ok(values.slice((Number(params.page??1)-1)*Number(params.limit??200),Number(params.page??1)*Number(params.limit??200)).map(Timesheet=>({Timesheet})))
  }
  if(['/tasks','/bugs','/stories'].some(base=>path===base||path===base+'/count')){
   const values=filtered(path.replace('/count',''),params)
   if(path.endsWith('/count'))return ok({count:values.length})
   return ok(values.slice((Number(params.page??1)-1)*Number(params.limit??200),Number(params.page??1)*Number(params.limit??200)).map(row=>({[path==='/tasks'?'Task':path==='/stories'?'Story':'Bug']:row})))
  }
  throw new Error('unexpected endpoint '+path)
 }
 let store=openStore(dir,vault)
 store.saveSettings({expectedRevision:0,credential:'ISOLATED_SCENARIO_TOKEN',patch:{chinaCalendar:{enabled:false},projects,members:directory.slice(0,3).map(user=>({staffId:user.user.split('_').at(-1),name:user.name,account:user.user})),currentUser:{staffId:'100',name:'A',account:'A_100'},groups:[{id:'default',name:'Team',memberIds:['100','200']},{id:'qa',name:'QA',memberIds:['300'],testing:true}],defaultGroupId:'default',tapd:{baseUrl:'https://api.tapd.cn',defaultTypes:['task','bug'],writeAccess:{operations:['create','update'],fields:['name','description','owner','effort','begin','due','story_id','status']}}}})
 let business=createBusiness(store,dir,transport),scenarios=createScenarios(business,store)
 return {dir,vault,transport,calls,rows,records,projects,get store(){return store},get business(){return business},get scenarios(){return scenarios},fault:value=>fault=value,writes:()=>writes,
 async restart(){await business.close();store.close();store=openStore(dir,vault);business=createBusiness(store,dir,transport);scenarios=createScenarios(business,store)},async close(){await business.close();store.close();rmSync(dir,{recursive:true,force:true})}}
}
const proposed=(hours=2)=>({tasks:[{ref:'new',title:'New',hours,storyId:'101',projectId:'1'}],...range})
test('link parsing preserves long IDs and rejects unrelated URLs',()=>{
 assert.deepEqual(parseReference('https://www.tapd.cn/tapd_fe/1/story/detail/1162119705001212279'),{workspaceId:'1',entityType:'story',id:'1162119705001212279'})
 assert.equal(parseReference('https://www.tapd.cn/1/prong/tasks/view/201').entityType,'task')
 assert.throws(()=>parseReference('https://elsewhere.test/tapd_fe/1/task/detail/2'),/INVALID_TAPD_LINK/)
})
test('project synchronization retains preferences and legacy metadata; new enabled projects permit allowed writes',async()=>{
 const f=fixture();try{
  const before=f.store.readSettings();f.store.saveSettings({expectedRevision:before.revision,patch:{projects:[{...before.settings.projects[0],enabled:false,alias:'Alias',color:'#abcdef',order:2}]}})
  const result=await f.scenarios.syncProjects();assert.equal(result.settings.currentUser.staffId,'100');assert.notEqual(result.settings.currentUser.staffId,'999')
  assert.equal(result.settings.projects.find(p=>p.id==='1').enabled,false);assert.equal(result.settings.projects.find(p=>p.id==='1').alias,'Alias');assert.equal(result.settings.projects.find(p=>p.id==='2').enabled,true)
  assert.equal('workspaceIds' in result.settings.tapd.writeAccess,false)
  assert.equal((await f.business.write({workspaceId:'2',entityType:'task',fields:{name:'New project'},idempotencyKey:'new-project-write',actor:'test'},'create')).status,'succeeded')
  const resolved=await f.scenarios.resolveMembers({query:'legacy-account'});assert.equal(resolved.status,'resolved');assert.equal(resolved.member.staffId,'user:legacy-account')
  assert.ok(!f.store.readSettings().settings.groups.find(g=>g.id==='default').memberIds.includes(resolved.member.staffId))
 }finally{await f.close()}
})
test('requirement context detects both testing rules, chooses earliest complete testing, and separates available materials/history',async()=>{
 const f=fixture();try{
  const context=await f.scenarios.requirementContext('https://www.tapd.cn/tapd_fe/1/story/detail/101',{includeHistory:true})
  assert.equal(context.status,'complete');assert.equal(context.earliestTesting.id,'202');assert.equal(context.tasks.filter(t=>t.isTesting).length,2)
  assert.equal(context.materials.inlineImages.length,1);assert.equal(context.materials.attachments.status,'complete')
  assert.equal(f.calls.find(call=>call.path==='/story_changes').params.limit,'100');assert.equal(context.history.rows[0].change_summary,'状态变更')
  const work=await f.scenarios.workContext({...range,scope:'self'});assert.deepEqual(work.context.memberIds,['100']);assert.ok(work.periodEvents.some(e=>e.kind==='story_change'));assert.ok(work.periodEvents.some(e=>e.kind==='task_change'));assert.equal(work.activityCoverage.taskHistory,'attempted')
 }finally{await f.close()}
})
test('replanning releases forecast only, retains actuals and includes occupancy from other projects',async()=>{
 const f=fixture();try{
  f.records.push({id:'r1',workspace_id:'1',entity_type:'task',entity_id:'201',owner:'A_100',spentdate:today,timespent:'3',is_delete:'0'})
  f.rows.set('task:204',{id:'204',workspace_id:'2',name:'Other project',owner:'A_100',begin:'2026-11-03',due:'2026-11-03',effort:'4',status:'open'})
  const result=await f.scenarios.plan({tasks:[{ref:'dev',title:'Development',hours:8,memberIds:['100'],originalTaskKey:'1:task:201'}],...range})
  assert.equal(result.status,'feasible');assert.equal(result.candidates[0].placements[0].daily.reduce((s,d)=>s+d.hours,0),5)
  const calc=f.scenarios.getCalculation(result.calculationId);const caps=f.scenarios.capacities(calc.analysis,['1:task:201'])
  assert.equal(caps['100'][0].actual,3);assert.equal(caps['100'][0].available,5);assert.equal(caps['100'][1].available,4)
 }finally{await f.close()}
})
test('urgent relocation can move old work beyond the urgent deadline but before earliest testing, all modes emit zero POST',async()=>{
 const f=fixture();try{
  const input={tasks:[{ref:'urgent',title:'Urgent',hours:8}],memberIds:['100'],analysisDate:today,start:today,deadline:today,end:'2026-11-06'}
  const direct=await f.scenarios.urgent({...input,mode:'direct'});assert.equal(direct.status,'infeasible')
  const moved=await f.scenarios.urgent({...input,mode:'reallocate'});assert.equal(moved.status,'feasible')
  const candidate=moved.results[0].result.candidates[0];assert.equal(candidate.placements.find(p=>p.ref==='urgent').end,today)
  assert.equal(candidate.placements.find(p=>p.ref==='existing:1:task:201').end,'2026-11-03')
  assert.equal(moved.boundaries[0].earliestTesting,'2026-11-04')
  const multi=await f.scenarios.urgent({...input,memberIds:['100','200'],tasks:[{ref:'a',title:'A',hours:8},{ref:'b',title:'B',hours:8}],mode:'multi'});assert.equal(multi.status,'feasible')
  await assert.rejects(f.scenarios.writeTasks({batchKey:'reject-simulation',calculationId:moved.results[0].calculationId,items:[{ref:'urgent',workspaceId:'1',fields:{name:'Urgent',effort:'8',story_id:'101'}}]}),/SIMULATION_IS_READ_ONLY/)
  assert.equal(f.writes(),0)
 }finally{await f.close()}
})
test('ordinary batches default to token owner, replay safely, reject intent changes, and survive restart',async()=>{
 const f=fixture();try{
  const request={batchKey:'ordinary-batch',items:[{ref:'new',workspaceId:'1',fields:{name:'New',description:'Scope',effort:'2',story_id:'101'}}]}
  const written=await f.scenarios.writeTasks(request);assert.equal(written.status,'succeeded');assert.equal(written.items[0].actual.owner,'A_100');assert.equal(written.items[0].actual.begin,undefined);assert.ok(written.items[0].tapdUrl)
  await f.scenarios.writeTasks(request);assert.equal(f.writes(),1)
  await assert.rejects(f.scenarios.writeTasks({...request,items:[{...request.items[0],fields:{...request.items[0].fields,name:'Changed'}}]}),/BATCH_ITEM_CONFLICT/)
  await f.restart();assert.equal((await f.scenarios.getTaskBatch(request.batchKey)).status,'succeeded');await f.scenarios.writeTasks(request);assert.equal(f.writes(),1)
 }finally{await f.close()}
})
test('partial success resumes definite failures; lost writes remain unknown until read-only verification',async()=>{
 const f=fixture();try{
  const request={batchKey:'partial-batch',items:[{ref:'a',workspaceId:'1',fields:{name:'ok',effort:'1',story_id:'101'}},{ref:'b',workspaceId:'1',fields:{name:'reject',effort:'1',story_id:'101'}}]}
  f.fault('reject');const partial=await f.scenarios.writeTasks(request);assert.deepEqual(partial.items.map(i=>i.status),['succeeded','failed'])
  f.fault('');const resumed=await f.scenarios.writeTasks({...request,retryFailed:true});assert.equal(resumed.status,'succeeded');assert.equal(f.writes(),3)
  f.fault('lost');const unknown=await f.scenarios.writeTasks({batchKey:'unknown-batch',items:[{ref:'lost',workspaceId:'1',fields:{name:'lost',effort:'1',story_id:'101'}}]});assert.equal(unknown.items[0].status,'unknown')
  f.fault('');await f.restart();await f.scenarios.writeTasks({batchKey:'unknown-batch',retryFailed:true,items:[{ref:'lost',workspaceId:'1',fields:{name:'lost',effort:'1',story_id:'101'}}]});assert.equal(f.writes(),4)
  const remote=[...f.rows.values()].find(row=>row.name==='lost');await f.business.verifyOperation(unknown.items[0].operationId,remote.id);assert.equal((await f.scenarios.getTaskBatch('unknown-batch')).status,'succeeded');assert.equal(f.writes(),4)
 }finally{await f.close()}
})
test('dated batch validates fresh capacity and refuses stale plans, calculations expire on restart',async()=>{
 const f=fixture();try{
  const planned=await f.scenarios.plan(proposed()),request={batchKey:'dated-batch',calculationId:planned.calculationId,items:[{ref:'new',workspaceId:'1',fields:{name:'New',effort:'2',story_id:'101'}}]}
  const result=await f.scenarios.writeTasks(request);assert.equal(result.status,'succeeded');assert.equal(result.items[0].actual.begin,planned.candidates[0].placements[0].start)
  const stale=await f.scenarios.plan({...proposed(),tasks:[{ref:'stale',title:'Stale',hours:1}]})
  f.rows.get('task:201').effort='16'
  await assert.rejects(f.scenarios.writeTasks({batchKey:'stale-batch',calculationId:stale.calculationId,items:[{ref:'stale',workspaceId:'1',fields:{name:'Stale',effort:'1',story_id:'101'}}]}),/STALE_PLAN/)
  await f.restart();assert.throws(()=>f.scenarios.getCalculation(planned.calculationId),/CALCULATION_EXPIRED/)
 }finally{await f.close()}
})
test('source failures keep urgent conclusions unknown',async()=>{
 const f=fixture();try{f.fault('directory');const result=await f.scenarios.urgent({tasks:[{ref:'u',title:'U',hours:1}],memberIds:['100'],mode:'direct',deadline:today,start:today,analysisDate:today});assert.equal(result.status,'needs_information');assert.equal(f.writes(),0)}finally{await f.close()}
})
test('real MCP transport exposes new tools, enforces generic schemas, and filters all pages before slicing',async()=>{
 const f=fixture();let service,client,transport
 try{
  for(let i=0;i<205;i++)f.rows.set('task:'+String(1000+i),{id:String(1000+i),workspace_id:'2',name:'Page '+i,owner:'B_200',begin:today,due:today,effort:'0',status:'open'})
  const calendar={'2026-11-03':{working:false,name:'假日'},'2026-11-05':{working:true,name:'调休'}}
  f.store.saveSettings({expectedRevision:f.store.readSettings().revision,patch:{chinaCalendar:{enabled:true,years:{'2026':{year:2026,fetchedAt:'2026-01-01T00:00:00Z',papers:['https://example.test/2026'],days:calendar}}}}})
  const analysis=await f.business.analyze({...range,memberIds:['100','200']})
  const historical=structuredClone(analysis);delete historical.calendar
  const historicalFile=f.business.files.putFile('analysis',JSON.stringify(historical),'json','application/json')
  await f.business.close();f.store.close();service=await startServer({dataDir:f.dir,port:0,vault:f.vault,tapdTransport:f.transport})
  client=new Client({name:'scene-test',version:'1'});transport=new StreamableHTTPClientTransport(new URL(service.info.url),{requestInit:{headers:{Authorization:'Bearer '+readFileSync(join(f.dir,'access-token'),'utf8').trim()}}});await client.connect(transport)
  const call=(name,args={})=>client.callTool({name,arguments:args})
  for(const target of ['write','general','leave','import'])assert.equal((await call('teamsight_open_settings',{target})).isError,true)
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='teamsight_simulate_urgent'));assert.ok(tools.tools.some(t=>t.name==='teamsight_write_tasks'))
  const invalid=await call('tapd_call_operation',{operationId:'users.current',parameters:{url:'https://elsewhere.test'}});assert.equal(invalid.isError,true)
  const current=await call('tapd_call_operation',{operationId:'users.current',parameters:{}});assert.equal(current.structuredContent.nick,'A_100')
  const view=await call('teamsight_read_analysis',{analysisId:analysis.analysisId,projectIds:['2'],memberIds:['200'],taskOffset:200});assert.equal(view.structuredContent.tasks.length,5);assert.equal(view.structuredContent.members.length,1);assert.deepEqual(view.structuredContent.calendar,calendar)
  const firstPage=await call('teamsight_read_analysis',{analysisId:analysis.analysisId,projectIds:['2'],memberIds:['200']});assert.deepEqual(firstPage.structuredContent.calendar,view.structuredContent.calendar)
  assert.equal('calendar' in (await call('teamsight_read_analysis',{analysisId:historicalFile.id})).structuredContent,false)
  const narrowed=await call('teamsight_read_analysis',{analysisId:analysis.analysisId,projectIds:['2'],start:'2026-11-03',end:'2026-11-04'});assert.equal(narrowed.structuredContent.counts.tasks,0);assert.deepEqual(narrowed.structuredContent.context.range,{start:'2026-11-03',end:'2026-11-04'});assert.deepEqual(narrowed.structuredContent.calendar,{'2026-11-03':calendar['2026-11-03']})
  assert.doesNotMatch(JSON.stringify((await call('teamsight_get_config')).structuredContent),/ISOLATED_SCENARIO_TOKEN/)
 }finally{await transport?.terminateSession().catch(()=>{});await client?.close();await service?.close();rmSync(f.dir,{recursive:true,force:true})}
})

test('rescheduling updates the existing task and durable batch metadata is present before POST',async()=>{
 const f=fixture();try{
  const before=await f.business.readItem({workspaceId:'1',entityType:'task',id:'201'})
  const planned=await f.scenarios.plan({tasks:[{ref:'existing',title:'Development',hours:8,originalTaskKey:'1:task:201',projectId:'1',storyId:'101'}],...range})
  f.fault('inspect');const result=await f.scenarios.writeTasks({batchKey:'update-existing-batch',calculationId:planned.calculationId,items:[{ref:'existing',workspaceId:'1',id:'201',expectedDigest:before.digest,fields:{}}]})
  assert.equal(result.status,'succeeded');assert.equal(result.items[0].remoteId,'201');assert.equal(f.writes(),1)
  assert.equal(f.calls.find(call=>call.method==='POST').params.id,'201')
  const receipt=result.items[0];f.business.files.updateOperation(receipt.operationId,{status:'in_flight'})
  await f.restart();assert.equal((await f.scenarios.getTaskBatch('update-existing-batch')).status,'succeeded');assert.equal(f.writes(),1)
 }finally{await f.close()}
})
test('MCP uses current daily capacity for ordinary and urgent planning; retired leave settings are rejected',async()=>{
 const f=fixture();try{
  const current=f.store.readSettings();assert.throws(()=>f.store.saveSettings({expectedRevision:current.revision,patch:{hours:{exemptions:[]}}}),/INVALID_CONFIG/)
  const result=await f.scenarios.plan({...proposed(6),start:'2026-11-03',end:'2026-11-04'})
  assert.equal(result.status,'feasible');assert.ok(result.candidates.every(c=>c.placements[0].daily.some(d=>d.date==='2026-11-03'&&d.hours===6)))
  const analysis=f.scenarios.getCalculation(result.calculationId).analysis,day=analysis.members[0].days.find(d=>d.date==='2026-11-03')
  assert.equal(day.target,8);assert.equal("leaveHours" in day,false);assert.equal(f.scenarios.capacities(analysis)['100'].find(d=>d.date==='2026-11-03').available,8)
  const urgent=await f.scenarios.urgent({mode:'direct',tasks:[{ref:'u',title:'Urgent',hours:8}],memberIds:['100'],start:'2026-11-03',deadline:'2026-11-03',analysisDate:today})
  assert.equal(urgent.status,'feasible');assert.equal(f.writes(),0);assert.equal('exemptions' in f.store.readSettings().settings.hours,false)
  f.rows.get('task:202').due=null
  const context=await f.scenarios.requirementContext({workspaceId:'1',entityType:'story',id:'101'},{testerMemberIds:['100']})
  assert.equal(context.earliestTesting.id,'201');assert.equal(context.tasks.find(task=>task.id==='202').isTesting,true)
 }finally{await f.close()}
})


test('non-current analysis rules cannot supply capacity, simulation or writes',async()=>{
 const f=fixture()
 try{
  const planned=await f.scenarios.plan(proposed(2))
  const calculation=f.scenarios.getCalculation(planned.calculationId)
  calculation.analysis.context.rulesVersion='teamsight-hours-v1.2'
  assert.throws(()=>f.scenarios.capacities(calculation.analysis,[]),/ANALYSIS_RULES_OUTDATED/)
  assert.throws(()=>f.scenarios.calculationView(planned.calculationId),/ANALYSIS_RULES_OUTDATED/)
  await assert.rejects(f.scenarios.writeTasks({batchKey:'outdated-rules-batch',calculationId:planned.calculationId,items:[{ref:'new',workspaceId:'1',fields:{name:'No write',story_id:'101'}}]}),/ANALYSIS_RULES_OUTDATED/)
  assert.equal(f.writes(),0)
 }finally{await f.close()}
})

test('batches apply enabled project scope per item without the old write whitelist',async()=>{
 const f=fixture()
 try{
  f.rows.set('story:102',{id:'102',workspace_id:'2',name:'Other requirement'})
  f.store.saveSettings({expectedRevision:f.store.readSettings().revision,patch:{projects:f.projects.map(p=>({...p,enabled:p.id==='2'}))}})
  const result=await f.scenarios.writeTasks({batchKey:'enabled-project-batch',items:[
   {ref:'disabled',workspaceId:'1',fields:{name:'Disabled',effort:'1',story_id:'101'}},
   {ref:'enabled',workspaceId:'2',fields:{name:'Enabled',effort:'1',story_id:'102'}}
  ]})
  assert.deepEqual(result.items.map(item=>item.status),['failed','succeeded']);assert.equal(result.items[0].code,'WRITE_NOT_ALLOWED');assert.equal(f.writes(),1)
  assert.equal((await f.scenarios.requirementContext('https://www.tapd.cn/tapd_fe/1/story/detail/101',{includeMaterials:false})).story.id,'101')
 }finally{await f.close()}
})

test('simulation copies the saved calendar independently of current settings',async()=>{
 const f=fixture();try{
  const planned=await f.scenarios.plan(proposed(2)),calculation=f.scenarios.getCalculation(planned.calculationId)
  const calendar={'2026-11-06':{working:false,name:'快照假日'}};calculation.analysis.calendar=calendar
  const view=f.scenarios.calculationView(planned.calculationId)
  assert.deepEqual(view.calendar,calendar);view.calendar['2026-11-06'].working=true;assert.equal(calendar['2026-11-06'].working,false)
  delete calculation.analysis.calendar;assert.equal(f.scenarios.calculationView(planned.calculationId).calendar,undefined)
 }finally{await f.close()}
})
