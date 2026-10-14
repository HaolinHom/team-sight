import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env.local', root), 'utf8').split('\n').flatMap(line => { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); return m ? [[m[1], m[2].replace(/^"|"$/g, '')]] : []; }));
const credentialFile = process.env.HOME + '/Library/Application Support/com.haolinhom.team-sight/credentials.json';
const token = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')).token : env.PERSONAL_TOKEN;
if (!token) throw new Error('没有可用的 TAPD 凭据');
const workspace = env.WORKSPACE_IDS.split(',')[0].trim();
async function call(path, params) {
  const url = new URL('https://api.tapd.cn' + path);
  for (const [key, value] of Object.entries({ workspace_id: workspace, ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  const result = await response.json();
  if (result.status !== 1) throw new Error(path + ': HTTP ' + response.status + ', ' + result.info);
  return result;
}
const now = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(new Date());
const month = now.slice(0,7) + '-01';
const logs = await call('/timesheets', {spentdate:month+'~'+now,limit:'200',is_delete:'0',include_parent_story_timesheet:'0',fields:'id,workspace_id,entity_type,entity_id,owner,spentdate,timespent,is_delete'});
const rows = logs.data.map(item=>item.Timesheet);
const count = await call('/timesheets/count', {spentdate:month+'~'+now,is_delete:'0'});
console.log(JSON.stringify({check:'timesheets',count:count.data.count,sampleSize:rows.length,fields:rows[0]?Object.keys(rows[0]):[],dateFilterValid:rows.every(r=>r.spentdate>=month&&r.spentdate<=now),ownerFormatValid:rows.every(r=>/_(\d+)$/.test(r.owner)),types:[...new Set(rows.map(r=>r.entity_type))]},null,2));
const users = (await call('/workspaces/users', {limit:'200'})).data.map(r=>r.UserWorkspace);
console.log(JSON.stringify({check:'owner mapping', userFields:users[0]?Object.keys(users[0]):[],exactUser:rows.filter(r=>users.some(u=>u.user===r.owner)).length,exactName:rows.filter(r=>users.some(u=>u.name===r.owner)).length}));
const configFile=process.env.HOME+'/Library/Application Support/com.haolinhom.team-sight/settings.json';
const configured=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')).members:[];
const user=users.find(u=>configured.some(m=>u.user.endsWith('_'+m.staffId)))??users[0];
for (const [path,field] of [['/tasks','owner'],['/bugs','current_owner']]) {
 const c=await call(path+'/count',{[field]:user.user});
 const p=await call(path,{[field]:user.user,limit:'3',fields:'id,owner,current_owner,begin,due,status,effort'});
 const items=p.data.map(i=>i[path==='/tasks'?'Task':'Bug']);
 console.log(JSON.stringify({check:path+' scoped member',count:c.data.count,sampleSize:items.length,ownerFilterValid:items.every(i=>(i[field]??'').split(';').includes(user.user)),fields:items[0]?Object.keys(items[0]):[]}));
}
console.log('PASS: readonly TAPD hours API checks');

if (process.argv.includes('--snapshot')) {
 const { createServer } = await import('vite');
 const server = await createServer({server:{middlewareMode:true},appType:'custom'});
 try {
  const {fetchHoursSnapshot}=await server.ssrLoadModule('/src/services/tapd/hours.ts');
  const {calculateHours}=await server.ssrLoadModule('/src/hours/statistics.ts');
  const {createHoursSettings}=await server.ssrLoadModule('/src/hours/settings.ts');
  const memberId=/_(\d+)$/.exec(user.user)?.[1];
  if (!memberId) throw new Error('样本成员没有稳定工号');
  const settings=createHoursSettings();
  const liveQuery={projects:[{id:workspace,name:'接口验收项目',enabled:true,color:'#3b82f6'}],members:[{staffId:memberId,name:'验收成员'}],range:{start:month,end:now},today:now,settings};
  const {createHoursCache}=await server.ssrLoadModule('/src/services/tapd/hoursCache.ts');
  const cache=createHoursCache();
  const snapshot=await fetchHoursSnapshot(liveQuery,call,{cache});
  if(snapshot.status==='failed') throw new Error('实际加载全部失败');
  const matrix=calculateHours({snapshot,members:[{staffId:memberId,name:'验收成员'}],settings,range:{start:month,end:now},today:now});
  const actual=matrix[0].days.reduce((sum,day)=>sum+day.actual,0);
  const expected=snapshot.records.filter(record=>record.staffId===memberId&&record.spentDate>=month&&record.spentDate<=now).reduce((sum,record)=>sum+record.hours,0);
  if(Math.abs(actual-expected)>1e-9) throw new Error('矩阵实际花费与原记录不一致');
  console.log(JSON.stringify({check:'live hours snapshot + calculation',status:snapshot.status,tasks:snapshot.tasks.length,records:snapshot.records.length,issues:snapshot.issues.length,issueMessages:snapshot.issues.map(issue=>issue.message),metrics:snapshot.metrics,days:matrix[0].days.length,actualTotalMatches:true,pendingTasks:matrix[0].pending.length}));
  const cached=await fetchHoursSnapshot(liveQuery,call,{cache});
  const shifted=await fetchHoursSnapshot({...liveQuery,range:{start:month,end:month}},call,{cache});
  console.log(JSON.stringify({check:'live cache reuse',cached:cached.metrics,shifted:shifted.metrics}));
  if(cached.metrics.requests!==0)throw new Error('完整查询未复用缓存');
  console.log('PASS: live hours snapshot and daily totals');
 } finally { await server.close(); }
}
