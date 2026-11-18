// Run only from the TeamSight repository; uses an existing marked validation requirement.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {openStore} from '../../../../apps/server/dist/storage.js'
import {createBusiness} from '../../../../apps/server/dist/business.js'
import {createScenarios} from '../../../../apps/server/dist/scenarios.js'
import {businessDate} from '../../../../packages/core/dist/index.js'
if(!process.argv.includes('--execute-writes'))throw new Error('EXPLICIT_LIVE_WRITE_FLAG_REQUIRED')
const workspace='62119705',story='1162119705001212279',dir=resolve('.local/teamsight-mcp-m5-live'),evidence='artifacts/report/evidence/20261103-mcp'
const line=readFileSync('.env.local','utf8').split(/\r?\n/).find(line=>/^PERSONAL_TOKEN=/.test(line));if(!line)throw new Error('TOKEN_NOT_AVAILABLE')
const token=line.slice(line.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2'),secrets=new Map(),vault={put:(id,value)=>secrets.set(id,value),get:id=>secrets.get(id)??null,remove:id=>secrets.delete(id)}
const originalFetch=globalThis.fetch;let posts=0
globalThis.fetch=(url,options)=>{if(new URL(String(url)).hostname==='api.tapd.cn'&&options?.method==='POST')posts++;return originalFetch(url,options)}
let store=openStore(dir,vault),business=createBusiness(store,dir),scenes=createScenarios(business,store),createdTaskId,results={workspaceId:workspace,validationRequirement:story}
const batch='teamsight-mcp-m5-live-create-20261103',scheduleBatch='teamsight-mcp-m5-live-schedule-20261103',finalBatch='teamsight-mcp-m5-live-finalize-20261103',title='[TeamSight MCP M5 验证 20261103] 批次创建与补排期（0h）'
try{
 let config=store.readSettings();store.saveSettings({expectedRevision:config.revision,credential:token,patch:{tapd:{...config.settings.tapd,workspaceIds:[workspace],writeAccess:{workspaceIds:[workspace],operations:['create','update'],fields:['name','description','owner','effort','story_id','begin','due','status']}},projects:[{id:workspace,name:'MCP验证范围',enabled:true,color:'#167d7f'}]}})
 const parent=await business.readItem({workspaceId:workspace,entityType:'story',id:story})
 if(!/TeamSight.*(?:验证|验收)|(?:验证|验收).*TeamSight/i.test(String(parent.item.name??'')))throw new Error('PARENT_NOT_A_MARKED_VALIDATION_REQUIREMENT')
 await scenes.syncProjects();config=store.readSettings();const user=config.settings.currentUser;if(!user?.account)throw new Error('CURRENT_USER_UNRESOLVED')
 scenes.updateConfig(config.revision,{projects:config.settings.projects.map(project=>({...project,enabled:project.id===workspace}))})
 console.log(JSON.stringify({stage:'marked-parent-and-token-user-verified',scope:'isolated-project',writesEnabled:true}))
 const request={batchKey:batch,items:[{ref:'validation',workspaceId:workspace,fields:{name:title,description:'仅用于 TeamSight MCP M5 批量创建、原任务补排期及回执恢复验收；0h，不代表真实工作量。',effort:'0',story_id:story}}]}
 const created=await scenes.writeTasks(request);if(created.status!=='succeeded')throw new Error('CREATE_'+created.items[0]?.status)
 createdTaskId=created.items[0].remoteId;results.create={status:created.status,taskId:createdTaskId,operationId:created.items[0].operationId};const beforeReplay=posts
 await scenes.writeTasks(request);if(posts!==beforeReplay)throw new Error('REPLAY_EMITTED_POST');results.createReplayNoPost=true
 console.log(JSON.stringify({stage:'create-and-replay-verified',taskId:createdTaskId}))
 const today=businessDate('Asia/Shanghai'),endDate=new Date(today+'T00:00:00Z');endDate.setUTCDate(endDate.getUTCDate()+13)
 const plan=await scenes.plan({tasks:[{ref:'existing',title,hours:0,memberIds:[user.staffId],projectId:workspace,storyId:story,originalTaskKey:workspace+':task:'+createdTaskId}],analysisDate:today,start:today,end:endDate.toISOString().slice(0,10),maxStates:1000})
 results.plan={status:plan.status,candidates:plan.candidates.length};console.log(JSON.stringify({stage:'planning-complete',status:plan.status}))
 if(plan.status!=='feasible')throw new Error('PLAN_'+plan.status)
 const current=await business.readItem({workspaceId:workspace,entityType:'task',id:createdTaskId})
 const scheduled=await scenes.writeTasks({batchKey:scheduleBatch,calculationId:plan.calculationId,items:[{ref:'existing',workspaceId:workspace,id:createdTaskId,expectedDigest:current.digest,fields:{status:'done'}}]})
 if(scheduled.status!=='succeeded')throw new Error('UPDATE_'+scheduled.items[0]?.status)
 const actual=scheduled.items[0].actual;if(actual.id!==createdTaskId||actual.begin!==plan.candidates[0].placements[0].start||actual.status!=='done')throw new Error('READBACK_MISMATCH')
 results.reschedule={status:'succeeded',sameTaskId:true,begin:actual.begin,due:actual.due,statusAfter:'done',operationId:scheduled.items[0].operationId}
 const beforeRestart=posts;await business.close();store.close();store=openStore(dir,vault);business=createBusiness(store,dir);scenes=createScenarios(business,store)
 if((await scenes.getTaskBatch(batch)).status!=='succeeded'||(await scenes.getTaskBatch(scheduleBatch)).status!=='succeeded')throw new Error('RECOVERY_MISMATCH')
 await scenes.writeTasks(request);if(posts!==beforeRestart)throw new Error('RESTART_REPLAY_POST')
 results.restartRecovery=true;results.ok=true
}catch(error){results.ok=false;results.code=error.code??error.message;console.log(JSON.stringify({stage:'verification-failed',code:results.code}))
 if(createdTaskId){try{const current=await business.readItem({workspaceId:workspace,entityType:'task',id:createdTaskId});if(current.item.status!=='done'){const closed=await scenes.writeTasks({batchKey:finalBatch,items:[{ref:'finalize',workspaceId:workspace,id:createdTaskId,expectedDigest:current.digest,fields:{status:'done'}}]});results.finalized=closed.status==='succeeded'}}catch{results.finalized=false}}
}finally{
 results.realTapdPosts=posts;results.tapdUrl=createdTaskId?'https://www.tapd.cn/tapd_fe/'+workspace+'/task/detail/'+createdTaskId:undefined;results.dataDir=dir;results.date=new Date().toISOString();mkdirSync(evidence,{recursive:true});writeFileSync(evidence+'/live-batch-write.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));await business.close();store.close();globalThis.fetch=originalFetch;secrets.clear()
}
