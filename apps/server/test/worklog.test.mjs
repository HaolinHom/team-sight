import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {openStore} from '../dist/storage.js'
import {createBusiness} from '../dist/business.js'
import {startServer} from '../dist/server.js'
import {ganttSvgs,renderGantt} from '../dist/outputs.js'
import {buildGanttDisplayTasks} from '@teamsight/core'
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
const member={staffId:'800167533',name:'洪浩林',account:'洪浩林_800167533'}
const range={start:'2026-10-01',end:'2026-10-31',analysisDate:'2026-11-05'}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'teamsight-worklog-')),secrets=new Map(),calls=[]
 const vault={put:(id,v)=>secrets.set(id,v),get:id=>secrets.get(id)??null,remove:id=>secrets.delete(id)}
 const project={id:'1',name:'项目',enabled:true,color:'#167d7f'}
 const task=(id,extra={})=>({id,workspace_id:'1',name:id,owner:member.account,begin:'2026-10-15',due:'2026-10-15',status:'done',effort:'8',...extra})
 const tasks=[task('201'),task('202',{name:'下图-回收站功能',begin:null,due:null})]
 const bugs=['301','302','303'].map(id=>({id,workspace_id:'1',title:'已流转缺陷 '+id,current_owner:'测试_800000001',begin:'2026-10-15',due:'2026-10-23',status:'closed'}))
 const records=[['2026-10-09','task','201',4],['2026-10-09','task','202',4],['2026-10-10','task','202',4],['2026-10-15','task','201',8],['2026-10-15','bug','301',.5],['2026-10-19','task','201',1],['2026-10-19','bug','302',6],['2026-10-19','bug','303',1],['2026-10-20','bug','404',1]].map(([spentdate,entity_type,entity_id,timespent],i)=>({id:String(i),workspace_id:'1',owner:member.account,is_delete:'0',spentdate,entity_type,entity_id,timespent}))
 const ok=data=>({status:1,httpStatus:200,info:'success',data})
 const transport=async(path,p,signal,request)=>{signal?.throwIfAborted();assert.notEqual(request?.method,'POST');calls.push({path,p})
  if(path==='/workspaces/users')return ok([{UserWorkspace:{user:member.account}}])
  if(path==='/timesheets')return ok(records.filter(r=>(!p.entity_id||p.entity_id===r.entity_id)&&r.spentdate>=p.spentdate.split('~')[0]&&r.spentdate<=p.spentdate.split('~')[1]).map(Timesheet=>({Timesheet})))
  if(path==='/tasks'||path==='/bugs'){const key=path==='/tasks'?'Task':'Bug',rows=path==='/tasks'?tasks:bugs;return ok(rows.filter(r=>(!p.id||p.id===r.id)&&(!p.owner||p.owner===r.owner)&&(!p.current_owner||p.current_owner===r.current_owner)).map(row=>({[key]:row})))}
  throw new Error('Unexpected '+path)
 }
 const store=openStore(dir,vault);store.saveSettings({expectedRevision:0,credential:'FIXTURE_ONLY',patch:{projects:[project],members:[member],groups:[{id:'default',name:'团队',memberIds:[member.staffId]}],defaultGroupId:'default',tapd:{baseUrl:'https://api.tapd.cn',defaultTypes:['task','bug']}}})
 const business=createBusiness(store,dir,transport)
 return {dir,vault,store,business,calls,transport,async close(){await business.close();store.close();rmSync(dir,{recursive:true,force:true})}}
}
test('worklog item hydration is deduplicated, read-only and excluded from computation; failed metadata keeps a separate row',async()=>{
 const f=fixture();try{
  const a=await f.business.analyze(range)
  assert.equal(a.snapshot.tasks.length,2);assert.equal(a.contributionItems.length,4)
  assert.equal(a.contributionItems.filter(i=>i.task).length,3);assert.ok(a.contributionItems.find(i=>i.taskKey==='1:bug:404').warning)
  assert.equal(f.calls.filter(c=>c.path==='/bugs'&&c.p.id==='301').length,1)
  assert.equal(a.status,'complete');assert.equal(a.snapshot.issues.length,0)
  const display=buildGanttDisplayTasks(a.snapshot.tasks,a.members,a.context.range,a.contributionItems)
  assert.deepEqual(display.find(t=>t.id==='301').displaySpans.map(s=>[s.kind,s.start,s.end]),[['actual','2026-10-15','2026-10-15']])
  assert.equal(display.find(t=>t.id==='404').displaySpans[0].start,'2026-10-20')
  const actual=date=>a.members[0].days.find(d=>d.date===date).actual
  assert.deepEqual([actual('2026-10-15'),actual('2026-10-19'),actual('2026-10-09'),actual('2026-10-10')],[8.5,8,8,4])
  assert.equal(a.risks.filter(r=>r.taskKey?.includes(':bug:')).length,0)
  const svgs=ganttSvgs(a);assert.match(svgs.join(''),/已流转缺陷 301/);assert.match(svgs.join(''),/按工时补充 2026-10-09—2026-10-10/);assert.match(svgs.join(''),/stroke-dasharray="3 2"/)
  for(const format of ['svg','png','html']){const artifacts=renderGantt(a,f.business.files,format);assert.ok(artifacts.length);assert.ok(artifacts.every(file=>file.size>100))}
  const cross=structuredClone(a)
  for(const day of cross.members[0].days) {day.contributions=day.contributions.filter(c=>c.taskKey!=='1:task:202');if(['2026-10-29','2026-10-31'].includes(day.date))day.contributions.push({taskKey:'1:task:202',projectId:'1',actual:4,allocated:0})}
  const crossPages=ganttSvgs(cross);assert.match(crossPages[0],/按工时补充 2026-10-29—2026-10-31/);assert.match(crossPages.at(-1),/按工时补充 2026-10-29—2026-10-31/)
  const sorted=structuredClone(a);sorted.contributionItems=[];for(const m of sorted.members)for(const d of m.days)d.contributions=[]
  sorted.snapshot.tasks=[...Array.from({length:31},(_,i)=>({...a.snapshot.tasks[0],id:'late'+i,startDate:'2026-10-30',dueDate:'2026-10-30'})),{...a.snapshot.tasks[0],id:'early',title:'首行排序校验',startDate:'2026-10-01',dueDate:'2026-10-01'}]
  const sortedPages=ganttSvgs(sorted);assert.match(sortedPages[0],/首行排序校验/);assert.doesNotMatch(sortedPages[1],/首行排序校验/)
  const old=structuredClone(a);delete old.contributionItems
  assert.match(ganttSvgs(old).join(''),/缺陷 #301/)
 }finally{await f.close()}
})
test('display filtering occurs before pagination, retains transferred contributors and full-analysis virtual dates',async()=>{
 const f=fixture();let service,client,connection
 try{
  const a=await f.business.analyze(range)
  for(let i=0;i<205;i++)a.snapshot.tasks.push({...a.snapshot.tasks[0],id:'empty'+i,title:'应隐藏空任务'+i,startDate:null,dueDate:null})
  for(let i=0;i<205;i++)a.snapshot.tasks.push({...a.snapshot.tasks[0],id:String(1000+i)})
  a.analysisId=randomUUID();f.business.files.putFile('analysis',JSON.stringify(a),'json','application/json',{},a.analysisId)
  await f.business.close();f.store.close()
  service=await startServer({dataDir:f.dir,port:0,vault:f.vault,tapdTransport:f.transport})
  client=new Client({name:'worklog-test',version:'1'});connection=new StreamableHTTPClientTransport(new URL(service.info.url),{requestInit:{headers:{Authorization:'Bearer '+readFileSync(join(f.dir,'access-token'),'utf8').trim()}}});await client.connect(connection)
  const call=async args=>(await client.callTool({name:'teamsight_read_analysis',arguments:{analysisId:a.analysisId,memberIds:[member.staffId],projectIds:['1'],...args}})).structuredContent
  const first=await call({start:'2026-10-15',end:'2026-10-15'}),second=await call({start:'2026-10-15',end:'2026-10-15',taskOffset:200})
  assert.equal(first.tasks.length,200);assert.equal(first.nextTaskOffset,200);assert.equal(second.tasks.length,7);assert.equal(second.nextTaskOffset,null)
  assert.ok([...first.tasks,...second.tasks].some(t=>t.id==='301'))
  assert.equal(first.counts.tasks,207);assert.equal(second.counts.tasks,207)
  assert.ok([...first.tasks,...second.tasks].every(t=>!t.id.startsWith('empty')))
  const narrowed=await call({start:'2026-10-10',end:'2026-10-10'})
  assert.equal(narrowed.tasks.length,1);assert.equal(narrowed.tasks[0].displaySpans[0].start,'2026-10-09');assert.equal(narrowed.tasks[0].startDate,null)
  const before=f.calls.length;await call({start:'2026-10-15',end:'2026-10-15'});assert.equal(f.calls.length,before)
  const exported=ganttSvgs(a);assert.ok(exported.length>6);assert.match(exported.join(''),/已流转缺陷 301/)
  assert.doesNotMatch(exported.join(''),/应隐藏空任务/)
 }finally{await connection?.terminateSession().catch(()=>{});await client?.close();await service?.close();rmSync(f.dir,{recursive:true,force:true})}
})
