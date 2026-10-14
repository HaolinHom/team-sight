import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
 const {calculateHours}=await server.ssrLoadModule('/src/hours/statistics.ts');
 const {createHoursSettings}=await server.ssrLoadModule('/src/hours/settings.ts');
 const {addDays}=await server.ssrLoadModule('/src/gantt/dateUtils.ts');
 const referencePath=process.argv.find(arg=>arg.startsWith('--reference='))?.slice('--reference='.length);
 const reference=referencePath ? (await server.ssrLoadModule('/@fs'+referencePath)).calculateHours : undefined;
 const members=Array.from({length:6},(_,i)=>({staffId:String(i+100),name:'成员'+i}));
 const task=(i,start,due,effort,assignees=[members[i%6].staffId],status='open')=>({id:String(i),sourceType:'task',title:'任务'+i,projectId:'p',projectName:'项目',projectColor:'#888',assigneeId:assignees[0],assigneeName:'成员',assigneeIds:assignees,startDate:start,dueDate:due,effort,status,tapdUrl:''});
 const record=(i,entityId,staffId,date,hours)=>({id:String(i),projectId:'p',entityType:'task',entityId:String(entityId),staffId,spentDate:date,hours});
 const input=(tasks,records,settings=createHoursSettings())=>({snapshot:{tasks,records,issues:[],status:'complete'},members,settings,range:{start:'2026-10-01',end:'2026-10-31'},today:'2026-10-14'});
 for(const n of [300,1000,3000]) {
  const data=input(Array.from({length:n},(_,i)=>task(i,'2026-10-14','2027-01-12','80')),Array.from({length:n*5},(_,i)=>record(i,i%n,members[(i%n)%6].staffId,'2026-10-13',1)));
  const results={};
  for(const [name,calculate] of [['optimized',calculateHours],...(reference?[['reference',reference]]:[])]) {
   calculate(data);const times=[];for(let i=0;i<3;i++){const start=performance.now();calculate(data);times.push(Math.round(performance.now()-start));}results[name]=times;
  }
  console.log(JSON.stringify({environment:'Node SSR, synthetic',members:6,tasks:n,records:n*5,taskSpanDays:91,displayDays:31,calculationMs:results}));
 }
 if(reference) {
  let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const rounded=data=>JSON.parse(JSON.stringify(data,(_key,value)=>typeof value==='number'?Math.round(value*1e8)/1e8:value));
  for(let sample=0;sample<100;sample++) {
   const tasks=Array.from({length:30},(_,i)=>{const start=addDays('2026-10-01',Math.floor(random()*24));const due=addDays(start,Math.floor(random()*14));const assignees=sample%3===0?[members[i%6].staffId,members[(i+1)%6].staffId]:[members[i%6].staffId];return task(i,sample%7===0&&i%4===0?null:start,sample%11===0&&i%5===0?null:due,i%13===0?undefined:String(Math.floor(random()*30)),assignees,i%8===0?'done':'open');});
   const records=Array.from({length:150},(_,i)=>record(i,i%30,members[Math.floor(random()*6)].staffId,addDays('2026-09-20',Math.floor(random()*40)),Math.floor(random()*10)/2));
   const settings=createHoursSettings();settings.dailyRequiredHours=sample%2?7.5:8;settings.calendarOverrides=[{date:'2026-10-17',working:true,note:''},{date:'2026-10-15',working:false,note:''}];settings.exemptions=[{staffId:'100',date:'2026-10-14',note:''}];
   const data=input(tasks,records,settings);if(sample%5===0)data.snapshot.issues=[{projectId:'p',affects:'forecast',taskKey:'p:task:1',message:'累计未知'}];
   if(!isDeepStrictEqual(rounded(calculateHours(data)),rounded(reference(data))))throw new Error('输出对照失败：'+sample);
  }
  console.log('PASS: 100 seeded output comparisons (numeric tolerance 1e-8)');
 }
} finally { await server.close(); }
