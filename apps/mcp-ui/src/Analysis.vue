<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'
import type { TeamAnalysis, ScheduleTask, HoursIssue } from '@teamsight/core'
import GanttLayers from './GanttLayers.vue'
import { followHostTheme } from './host-theme'
import './theme.css'
type View = Pick<TeamAnalysis,'analysisId'|'snapshotId'|'status'|'fetchedAt'|'context'|'limitations'> & {members:TeamAnalysis['members'];tasks:ScheduleTask[];issues:HoursIssue[];counts:{issues:number};nextTaskOffset:number|null;nextMemberOffset:number|null}
type Presentation = {analysisId?:string;calculationId?:string;candidateId?:string;mode?:'tasks'|'hours';viewFilters?:Record<string,unknown>;jobId?:string;status?:string;simulation?:unknown;baseline?:boolean}
const app=new App({name:'TeamSight Gantt',version:'0.2.6'},{},{autoResize:true})
const view=ref<View>(),mode=ref<'tasks'|'hours'>('tasks'),busy=ref(true),error=ref(''),message=ref('正在连接…'),presentation=ref<Presentation>({})
let generation=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined
let input:Record<string,unknown>={}
const scope=computed(()=>view.value ? view.value.context.range.start+' — '+view.value.context.range.end+' · '+view.value.members.map(row=>row.member.name).join('、')+' · 项目 '+[...new Set(view.value.tasks.map(task=>task.projectName))].join('、') : '')
async function call(name:string,args:Record<string,unknown>) {
 const response=await app.callServerTool({name,arguments:JSON.parse(JSON.stringify(args))})
 const data=response.structuredContent as Record<string,unknown>|undefined
 if(response.isError||!data)throw new Error(data?.code==='CONFIG_REQUIRED'?'请在对话中完成相应配置后重新打开甘特图。':'读取失败：'+String(data?.code??'UNKNOWN'))
 return data
}
async function selection(value:Record<string,unknown>) {
 await app.updateModelContext({content:[{type:'text',text:JSON.stringify({analysisId:view.value?.analysisId,snapshotId:view.value?.snapshotId,calculationId:presentation.value.calculationId,candidateId:presentation.value.candidateId,viewFilters:presentation.value.viewFilters,mode:mode.value,...value})}]}).catch(()=>{})
}
async function load(data:Presentation,token:number) {
 const base={...(data.calculationId?{calculationId:data.calculationId,candidateId:data.candidateId}:{analysisId:data.analysisId}),...data.viewFilters}
 const first=await call('teamsight_read_analysis',base) as unknown as View
 if(disposed||generation!==token)return
 const result={...first,members:[...first.members],tasks:[...first.tasks]}
 // Both cursors retain exactly the same conversation scope on every request.
 for(const kind of ['Member','Task'] as const) {
  const cursor=kind==='Member'?'nextMemberOffset':'nextTaskOffset',offset=kind==='Member'?'memberOffset':'taskOffset'
  const seen=new Set<number>()
  while(result[cursor]!==null) {
   const nextOffset=result[cursor]
   if(seen.has(nextOffset))throw new Error('分页游标未前进，无法确认数据完整性。')
   seen.add(nextOffset)
   const next=await call('teamsight_read_analysis',{...base,[offset]:nextOffset}) as unknown as View
   if(disposed||generation!==token)return
   if(next.snapshotId!==result.snapshotId||next.analysisId!==result.analysisId)throw new Error('分析快照已变化，请在对话中重新打开。')
   if(kind==='Member')result.members.push(...next.members);else result.tasks.push(...next.tasks)
   result[cursor]=next[cursor]
  }
 }
 if(disposed||generation!==token)return
 view.value=result;busy.value=false;message.value='';void selection({kind:'view'})
}
async function receive(data:Presentation) {
 const token=++generation;clearTimeout(timer);view.value=undefined;error.value='';busy.value=true;message.value='正在读取完整排期…'
 presentation.value=data;mode.value=data.mode??'tasks'
 async function read() {
  try {
   if(data.analysisId||data.calculationId)await load(data,token)
   else if(data.jobId){
    const job=await call('teamsight_get_job',{jobId:data.jobId})
    if(disposed||generation!==token)return
    if(job.status==='completed'&&job.analysisId)await load({...data,analysisId:String(job.analysisId)},token)
    else if(job.status==='running')timer=setTimeout(()=>void read(),1500)
    else throw new Error('分析未完成：'+String(job.code??job.status))
   }else throw new Error('未收到分析结果，请在对话中指定范围后打开甘特图。')
  } catch(cause){if(!disposed&&generation===token){error.value=cause instanceof Error?cause.message:String(cause);busy.value=false}}
 }
 await read()
}
watch(mode,()=>{if(view.value)void selection({kind:'mode'})})
onMounted(async()=>{
 app.ontoolinput=({arguments:args})=>{input=args??{};if(input.mode==='tasks'||input.mode==='hours')mode.value=input.mode}
 app.ontoolresult=result=>{
  const data=result.structuredContent as Presentation|undefined
  if(result.isError){++generation;clearTimeout(timer);view.value=undefined;busy.value=false;error.value='分析无法打开，请在对话中查看错误并重试。';return}
  if(data)void receive({...data,mode:data.mode??input.mode as Presentation['mode'],viewFilters:data.viewFilters??Object.fromEntries(Object.entries(input).filter(([key])=>['memberIds','projectIds','start','end'].includes(key)))})
 }
 try{await app.connect();if(!disposed)followHostTheme(app)}catch(cause){if(!disposed){busy.value=false;error.value='宿主连接失败：'+String(cause)}}
})
onUnmounted(()=>{disposed=true;++generation;clearTimeout(timer)})
</script>
<template>
 <main class="analysis-card" :aria-busy="busy">
  <header><div><h1>{{presentation.simulation?(presentation.baseline?'调整前排期':'模拟排期'):'排期与工时'}}</h1><p class="muted scope">{{scope}}</p></div><div class="mode-switch" role="group" aria-label="甘特图模式"><button :aria-pressed="mode==='tasks'" @click="mode='tasks'">任务优先</button><button :aria-pressed="mode==='hours'" @click="mode='hours'">工时优先</button></div></header>
  <p v-if="busy" class="notice" role="status">{{message}}</p><p v-if="error" class="error" role="alert">{{error}}</p>
  <template v-if="view">
   <p v-if="view.status!=='complete'" class="warning">{{view.status==='partial'?'数据不完整，以下仅展示已知结果。':'取数失败，当前结果无法作为完整依据。'}}</p>
   <p v-if="presentation.simulation" class="notice">{{presentation.baseline?'当前 TAPD 安排':'模拟结果，尚未写入 TAPD'}} · 通过对话指定其他候选或对比范围</p>
   <div class="legend"><span><i class="actual"></i>工时达标</span><span><i class="past-short"></i>过去工时不足</span><span><i class="forecast"></i>当天 / 未来工时不足</span><span><i class="unknown"></i>未知</span><span>盒子包含当天关联任务 · 仅优先层可交互</span><span>虚线任务条：按工时补充</span></div>
   <GanttLayers :tasks="view.tasks" :members="view.members" :range="view.context.range" :today="view.context.analysisDate" :mode="mode" @select="selection" @open="url=>app.openLink({url}).catch(()=>{error='无法打开 TAPD 链接'})" />

   <footer><small>{{view.status==='complete'?'数据完整':'部分 / 未知数据'}} · 来源 {{view.fetchedAt}} · {{view.context.timeZone}}</small><details v-if="view.limitations.length||view.issues.length||presentation.viewFilters?.projectIds"><summary>范围与数据说明</summary><p v-if="presentation.viewFilters?.projectIds">项目范围内的工时与每日完整目标进行对照；不代表成员在其他项目没有投入。</p><p v-for="item in view.limitations" :key="item">{{item}}</p><p v-for="(issue,index) in view.issues" :key="index">{{issue.projectId}}：{{issue.message}}</p><p v-if="view.counts?.issues>view.issues.length">问题共 {{view.counts.issues}} 条，此处展示前 {{view.issues.length}} 条，完整依据可在对话中查询。</p></details></footer>
  </template>
 </main>
</template>
<style scoped>
.analysis-card{padding:16px;margin:0 auto;max-width:1600px}header{display:flex;gap:16px;justify-content:space-between;align-items:start;margin-bottom:16px}.scope{margin:6px 0 0;overflow-wrap:anywhere}.mode-switch{display:flex;flex-shrink:0;background:var(--ts-soft);padding:3px;border-radius:9px;gap:3px}.mode-switch button{border-color:transparent;background:transparent}.mode-switch button[aria-pressed=true]{background:var(--ts-selected);color:var(--ts-accent);border-color:var(--ts-accent)}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ts-muted);margin:12px 0}.legend span{display:flex;gap:5px;align-items:center}i{width:8px;height:8px;border-radius:2px}.actual{background:var(--ts-actual)}.forecast{background:var(--ts-forecast)}footer{margin-top:14px;color:var(--ts-muted);font-size:12px}summary{cursor:pointer}.pending{margin-top:14px}.pending article{padding:10px 0;border-bottom:1px solid var(--ts-line)}@media(max-width:540px){.analysis-card{padding:12px}header{flex-direction:column;gap:12px}.mode-switch{align-self:start}}
</style>
<style scoped>
.past-short{background:var(--ts-hours-past-short)}.unknown{background:var(--ts-hours-unknown)}
</style>
