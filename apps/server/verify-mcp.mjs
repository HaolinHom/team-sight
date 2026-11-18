// Offline acceptance: real native storage/credential vault and MCP transport, isolated TAPD transport only.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
const args=process.argv.slice(2),evidence=resolve(args.includes('--evidence-dir')?args[args.indexOf('--evidence-dir')+1]:'./evidence')
const dir=mkdtempSync(join(tmpdir(),'teamsight-mcp-verification-'))
let service,client,transport,cleanup
const originalFetch=globalThis.fetch
globalThis.fetch=async(url,options)=>{
 const match=String(url).match(/^https:\/\/(?:cdn\.jsdelivr\.net\/gh\/NateScarlet\/holiday-cn@master|raw\.githubusercontent\.com\/NateScarlet\/holiday-cn\/master)\/(\d{4})\.json$/)
 if(match){const year=Number(match[1]);return new Response(JSON.stringify({year,papers:['https://example.test/offline-calendar'],days:[{date:year+'-01-01',name:'元旦',isOffDay:true}]}))}
 return originalFetch(url,options)
}
try {
 const {runtimeProblem}=await import('./dist/runtime.js');if(runtimeProblem())throw new Error('NODE_UNSUPPORTED')
 const {startServer}=await import('./dist/server.js'),{openStore}=await import('./dist/storage.js'),{Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client')
 cleanup=()=>{if(existsSync(join(dir,'teamsight.sqlite'))){const store=openStore(dir);try{store.clearCredential()}finally{store.close()}}}
 const rows=new Map([['101',{id:'101',workspace_id:'1',name:'Isolated requirement',description:'Offline fixture'}]])
 let posts=0
 const ok=data=>({status:1,info:'success',httpStatus:200,data})
 const tapdTransport=async(path,params,_signal,request)=>{
  if(request?.method==='POST'){posts++;const id=params.id??String(200+posts),value={...params,id,status:'open'};rows.set(id,value);return ok({Task:value})}
  if(path==='/users/info')return ok({nick:'Offline_100',name:'Offline_100',id:'internal'})
  if(path==='/workspaces/user_participant_projects')return ok([{Workspace:{id:'1',name:'Offline'}}])
  if(path==='/workspaces/users')return ok([{UserWorkspace:{user:'Offline_100',name:'Offline'}}])
  if(path==='/tasks/custom_fields_settings')return ok([])
  if(path==='/attachments'||path==='/task_changes'||path==='/story_changes'||path==='/timesheets'||path==='/bugs')return ok([])
  if(path.endsWith('/count'))return ok({count:0})
  if(path==='/tasks'||path==='/stories'){const key=path==='/tasks'?'Task':'Story';return ok(params.id&&rows.has(params.id)?[{[key]:rows.get(params.id)}]:[])}
  throw new Error('UNREGISTERED_FIXTURE_ENDPOINT')
 }
 service=await startServer({dataDir:dir,port:0,tapdTransport})
 client=new Client({name:'teamsight-mcp-acceptance',version:'1'})
 transport=new StreamableHTTPClientTransport(new URL(service.info.url),{requestInit:{headers:{Authorization:'Bearer '+readFileSync(join(dir,'access-token'),'utf8').trim()}}});await client.connect(transport)
 const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result.structuredContent));return result.structuredContent}
 const missing=await client.callTool({name:'tapd_list_projects',arguments:{}});assert.equal(missing.structuredContent.code,'CONFIG_REQUIRED')
 const initial=await call('teamsight_get_config')
 assert.deepEqual(initial.settings.tapd.defaultTypes,['task','bug']);assert.deepEqual(initial.settings.tapd.writeAccess.operations,['create','update','comment']);assert.equal(initial.settings.tapd.writeAccess.fields.length,8);assert.equal(initial.settings.chinaCalendar.enabled,true)
 const saved=await call('teamsight_save_settings',{expectedRevision:initial.revision,patch:{},tapdToken:'TEAMSIGHT_MCP_ISOLATED_SENTINEL'})
 assert.deepEqual(saved.settings.tapd,initial.settings.tapd);assert.equal(saved.settings.chinaCalendar.enabled,true);assert.equal(saved.settings.schemaVersion,6);assert.equal(saved.settings.currentUser.staffId,'100');assert.equal(saved.settings.projects[0].enabled,true);assert.deepEqual(saved.settings.groups[0].memberIds,[])
 await call('teamsight_update_config',{expectedRevision:saved.revision,patch:{groups:[{id:'default',name:'Offline team',memberIds:['100']}],defaultGroupId:'default'}})
 const planned=await call('teamsight_plan_schedule',{tasks:[{ref:'new',title:'Offline task',hours:4,projectId:'1',storyId:'101'}],start:'2026-11-02',end:'2026-11-06',analysisDate:'2026-11-02'})
 assert.equal(planned.status,'feasible')
 await call('teamsight_open_analysis',{calculationId:planned.calculationId})
 const urgent=await call('teamsight_simulate_urgent',{mode:'direct',deadline:'2026-11-02',analysisDate:'2026-11-02',start:'2026-11-02',tasks:[{ref:'urgent',title:'Urgent',hours:2}]});assert.equal(urgent.isSimulation,true);assert.equal(posts,0)
 const status=await call('teamsight_status'),config=await call('teamsight_get_config')
 assert.doesNotMatch(JSON.stringify(config),/TEAMSIGHT_MCP_ISOLATED_SENTINEL/)
 const tools=await client.listTools();for(const name of ['teamsight_get_requirement_context','teamsight_get_work_context','teamsight_write_tasks','teamsight_get_task_batch'])assert.ok(tools.tools.some(tool=>tool.name===name))
 const result={ok:true,phase:status.phase,version:status.version,platform:process.platform,arch:process.arch,node:process.versions.node,tools:tools.tools.length,configurationBootstrap:true,freshDefaults:true,offlineCalendar:true,planning:true,urgentSimulation:true,remoteTapdPosts:0,codexNativeApps:'not-tested-by-this-script',windowsRuntime:process.platform==='win32'?'native-service-tested; Codex UI still requires manual acceptance':'not-tested'}
 mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'mcp-acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} finally {
 globalThis.fetch=originalFetch
 await transport?.terminateSession().catch(()=>{});await client?.close().catch(()=>{});await service?.close();try{cleanup?.()}finally{rmSync(dir,{recursive:true,force:true})}
}
