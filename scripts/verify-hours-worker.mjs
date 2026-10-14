import {Worker} from 'node:worker_threads';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
const assets=fileURLToPath(new URL('../dist/assets/',import.meta.url));
const name=(await readdir(assets)).find(name=>/^hours\.worker-.*\.js$/.test(name));
if(!name)throw new Error('请先构建前端Worker');
const worker=new Worker(`const{parentPort}=require('node:worker_threads');global.self=global;self.postMessage=data=>parentPort.postMessage(data);import(${JSON.stringify(new URL('../dist/assets/'+name,import.meta.url).href)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
try {
 await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 const members=Array.from({length:6},(_,i)=>({staffId:String(i+100),name:'成员'+i}));
 const tasks=Array.from({length:3000},(_,i)=>({id:String(i),sourceType:'task',title:'任务'+i,projectId:'p',projectName:'项目',projectColor:'#888',assigneeId:members[i%6].staffId,assigneeName:'成员',assigneeIds:[members[i%6].staffId],startDate:'2026-10-14',dueDate:'2027-01-12',effort:'80',status:'open',tapdUrl:''}));
 const records=Array.from({length:15000},(_,i)=>({id:String(i),projectId:'p',entityType:'task',entityId:String(i%3000),staffId:members[(i%3000)%6].staffId,spentDate:'2026-10-13',hours:1}));
 const input={members,settings:{dailyRequiredHours:8,calendarOverrides:[],exemptions:[],completedStates:[]},range:{start:'2026-10-01',end:'2026-10-31'},today:'2026-10-14'};
 let last=performance.now(),maxHeartbeatGap=0,ticks=0;
 const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGap=Math.max(maxHeartbeatGap,now-last);last=now;ticks++;},5);
 try {
  for(let id=1;id<=3;id++){
   const start=performance.now();const pending=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
   worker.postMessage({id,input,...(id===1?{snapshot:{tasks,records,issues:[],status:'complete'}}:{})});
   const result=await pending;
   if(result.error||result.rows?.length!==6)throw new Error(result.error??'Worker结果无效');
   console.log(JSON.stringify({check:'built worker',id,snapshotTransferred:id===1,calculationMs:Math.round(result.calculationMs),roundTripMs:Math.round(performance.now()-start)}));
  }
  console.log(JSON.stringify({check:'main heartbeat during worker',ticks,maxGapMs:Math.round(maxHeartbeatGap),environment:'Node worker_threads using production Worker bundle; not WebView timings'}));
 } finally {clearInterval(heartbeat);}
}finally{await worker.terminate();}
