// Isolated SDK browser host: fixture TAPD and memory vault, never the user's MCP instance.
import { createServer } from 'vite'
import { mkdtempSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../dist/server.js'
import { openStore } from '../dist/storage.js'
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const root=fileURLToPath(new URL('../../../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'teamsight-browser-')),secrets=new Map()
const vault={put:(id,value)=>secrets.set(id,value),get:id=>secrets.get(id)??null,remove:id=>secrets.delete(id)}
const members=[{staffId:'100',name:'前端成员',account:'Frontend_100'},{staffId:'200',name:'后端成员',account:'Backend_200'},{staffId:'300',name:'测试成员',account:'QA_300'}]
const rows=[{id:'201',name:'前端功能',owner:'Frontend_100',begin:'2026-11-02',due:'2026-11-03',effort:'12',status:'progressing'}, {id:'202',name:'接口开发',owner:'Backend_200',begin:'2026-11-02',due:'2026-11-04',effort:'16',status:'done'}, {id:'203',name:'测试验收',owner:'QA_300',begin:'2026-11-04',due:'2026-11-06',effort:'12',status:'open'}, {id:'204',name:'未排期修复',owner:'Frontend_100',effort:null,status:'open'}].map(row=>({...row,workspace_id:'1',story_id:'101',description:'隔离数据，用于核对交互与每日工时。'}))
const records=[{id:'r1',workspace_id:'1',entity_type:'task',entity_id:'201',owner:'Frontend_100',spentdate:'2026-11-02',timespent:'3',is_delete:'0'},{id:'r2',workspace_id:'1',entity_type:'task',entity_id:'204',owner:'Frontend_100',spentdate:'2026-11-02',timespent:'2',is_delete:'0'}]
const ok=data=>({status:1,info:'success',httpStatus:200,data})
const tapdTransport=async(path,p,_signal,request)=>{
 if(request?.method==='POST')throw new Error('PREVIEW_READ_ONLY')
 if(path==='/users/info')return ok({nick:'Frontend_100',id:'internal'})
 if(path==='/workspaces/user_participant_projects')return ok([{Workspace:{id:'1',name:'交互验证项目'}}])
 if(path==='/workspaces/users')return ok(members.map(m=>({UserWorkspace:{user:m.account,name:m.name}})))
 if(path==='/attachments'||path==='/task_changes'||path==='/story_changes')return ok([])
 if(path==='/stories')return ok([{Story:{id:'101',workspace_id:'1',name:'隔离需求',description:'需求正文'}}])
 let values=[],key='Task'
 if(path.startsWith('/timesheets')){key='Timesheet';values=records.filter(r=>(!p.entity_id||r.entity_id===p.entity_id)&&(!p.spentdate||r.spentdate>=p.spentdate.split('~')[0]&&r.spentdate<=p.spentdate.split('~')[1]))}
 else if(path.startsWith('/tasks'))values=rows.filter(r=>(!p.id||r.id===p.id)&&(!p.owner||r.owner===p.owner))
 else if(!path.startsWith('/bugs'))throw new Error('PREVIEW_ENDPOINT_UNREGISTERED')
 if(path.endsWith('/count'))return ok({count:values.length})
 return ok(values.map(row=>({[key]:row})))
}
const store=openStore(dir,vault);store.saveSettings({expectedRevision:0,credential:'PREVIEW_FIXTURE_ONLY',patch:{projects:[{id:'1',name:'交互验证项目',enabled:true,color:'#167d7f'}],members,currentUser:members[0],groups:[{id:'default',name:'研发与测试',memberIds:members.map(m=>m.staffId)},{id:'qa',name:'测试组',memberIds:['300'],testing:true}],defaultGroupId:'default',tapd:{baseUrl:'https://api.tapd.cn',workspaceIds:['1'],defaultTypes:['task','bug']}}});store.close()
const service=await startServer({dataDir:dir,port:0,vault,tapdTransport}),client=new Client({name:'browser-preview',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(service.info.url),{requestInit:{headers:{Authorization:'Bearer '+readFileSync(join(dir,'access-token'),'utf8').trim()}}});await client.connect(transport)
const analysis=await client.callTool({name:'teamsight_analyze_hours',arguments:{start:'2026-11-02',end:'2026-11-06',analysisDate:'2026-11-02',scope:'team'}})
if(!analysis.structuredContent.analysisId)throw new Error('PREVIEW_ANALYSIS_FAILED')
const vite=await createServer({root:join(root,'apps/mcp-ui'),configFile:false,server:{host:'127.0.0.1',port:43129,strictPort:true},plugins:[{name:'isolated-mcp-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 if(req.headers.host!=='127.0.0.1:43129')throw new Error('PREVIEW_HOST_REJECTED')
 if(req.method==='POST'&&req.headers.origin!=='http://127.0.0.1:43129')throw new Error('PREVIEW_ORIGIN_REJECTED')
 const url=new URL(req.url,'http://127.0.0.1:43129')
 if(url.pathname==='/initial'){const name=url.searchParams.get('page')==='settings'?'teamsight_open_settings':'teamsight_open_analysis';res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await client.callTool({name,arguments:name.endsWith('analysis')?{analysisId:analysis.structuredContent.analysisId,mode:url.searchParams.get('mode')??'tasks'}:{target:url.searchParams.get('target')??'overview'}})));return}
 if(url.pathname==='/rpc'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const params=JSON.parse(Buffer.concat(chunks));if(!['teamsight_read_analysis','teamsight_get_config','teamsight_read_settings','teamsight_save_settings','teamsight_sync_projects','teamsight_resolve_members','teamsight_open_analysis','teamsight_open_settings'].includes(params.name))throw new Error('PREVIEW_TOOL_BLOCKED');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await client.callTool(params)));return}
 if(['/analysis.html','/settings.html'].includes(url.pathname)){res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'apps/mcp-ui/dist',url.pathname.slice(1))));return}
 next()
 }catch(error){res.statusCode=400;res.end(String(error))}})}}]});await vite.listen();console.log(JSON.stringify({url:'http://127.0.0.1:43129/test/host.html',fixture:true,realTapdPosts:0}))
async function close(){await vite.close();await transport.terminateSession().catch(()=>{});await client.close();await service.close();rmSync(dir,{recursive:true,force:true});process.exit(0)}
process.once('SIGINT',close);process.once('SIGTERM',close)
