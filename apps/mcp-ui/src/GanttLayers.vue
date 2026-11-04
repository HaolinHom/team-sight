<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout, type ScheduleTask, type MemberHours, type DateRange, type DailyHours } from '@teamsight/core'
const props=defineProps<{tasks:ScheduleTask[];members:MemberHours[];range:DateRange;today:string;mode:'tasks'|'hours'}>()
const emit=defineEmits<{select:[value:Record<string,unknown>];open:[url:string]}>()
const container=ref<HTMLElement>(),width=ref(760)
let observer:ResizeObserver|undefined
onMounted(()=>{if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(entries=>{width.value=entries[0]?.contentRect.width??760});if(container.value)observer.observe(container.value)}})
onUnmounted(()=>observer?.disconnect())
const labelWidth=computed(()=>width.value<540?132:190)
const dayWidth=computed(()=>Math.max(48,(width.value-labelWidth.value)/Math.max(1,Math.round((Date.parse(props.range.end)-Date.parse(props.range.start))/86400000)+1)))
const selectedTask=ref<ScheduleTask>(),selectedDay=ref<{member:MemberHours;day:DailyHours}>()
watch(()=>[props.mode,props.tasks,props.members,props.range],()=>{selectedTask.value=undefined;selectedDay.value=undefined})
const scheduled=computed(()=>props.tasks.filter(task=>task.startDate&&task.dueDate&&task.startDate<=task.dueDate&&task.startDate<=props.range.end&&task.dueDate>=props.range.start))
const chartTasks=computed(()=>[...scheduled.value,...props.members.filter(member=>!scheduled.value.some(task=>task.assigneeIds.includes(member.member.staffId))).map(member=>({id:'idle:'+member.member.staffId,sourceType:'task',title:'无已排期任务',projectId:'',projectName:'',projectColor:'#ccc',assigneeId:member.member.staffId,assigneeIds:[member.member.staffId],assigneeName:member.member.name,startDate:null,dueDate:null,status:'',tapdUrl:''} as ScheduleTask))])
const layout=computed(()=>computeLayout({tasks:chartTasks.value,range:props.range,today:props.today,config:{labelColumnWidth:labelWidth.value,dayColumnWidth:dayWidth.value},memberOrder:props.members.map(member=>'staff:'+member.member.staffId),memberNames:new Map(props.members.map(member=>['staff:'+member.member.staffId,member.member.name])),memberKeysOf:task=>task.assigneeIds.filter(id=>props.members.some(member=>member.member.staffId===id)).map(id=>'staff:'+id)}))
const bands=computed(()=>layout.value.rows.filter(row=>row.type==='member').map((row,index,rows)=>({row,member:props.members.find(member=>'staff:'+member.member.staffId===row.memberKey),y:row.y+36,height:(rows[index+1]?.y??layout.value.totalHeight)-row.y})))
const cells=computed(()=>bands.value.flatMap(band=>band.member?.days.filter(day=>day.date>=props.range.start&&day.date<=props.range.end).map(day=>({band,member:band.member!,day,index:layout.value.days.indexOf(day.date)}))??[]))
const maximum=computed(()=>Math.max(1,...cells.value.flatMap(cell=>[cell.day.total,cell.day.target])))
const color=(value:string)=>/^#[a-f0-9]{6}$/i.test(value)?value:'#EB732D'
const taskFor=(key:string)=>props.tasks.find(task=>[task.projectId,task.sourceType,task.id].join(':')===key)
const number=(value:number)=>String(Math.floor((value+1e-9)*100)/100)
function selectTask(projectId:string,id:string,sourceType?:string) {if(props.mode!=='tasks')return;selectedTask.value=props.tasks.find(task=>task.id===id&&task.projectId===projectId&&(!sourceType||task.sourceType===sourceType));selectedDay.value=undefined;if(selectedTask.value)emit('select',{kind:'task',projectId,id})}
function selectDay(cell:typeof cells.value[number]) {if(props.mode!=='hours')return;selectedDay.value={member:cell.member,day:cell.day};selectedTask.value=undefined;emit('select',{kind:'hours',memberId:cell.member.member.staffId,date:cell.day.date})}
function barTask(bar:{taskId:string;projectId:string}) {return chartTasks.value.find(task=>task.sourceType+':'+task.id===bar.taskId&&task.projectId===bar.projectId)}
</script>
<template>
 <div ref="container" class="gantt-scroll" :data-mode="mode">
  <div class="gantt-canvas" :style="{width:layout.totalWidth+labelWidth+'px'}">
   <div class="date-header"><div class="name-header" :style="{width:labelWidth+'px'}">成员 / 任务</div><div v-for="date in layout.days" :key="date" class="date" :class="{today:date===today,weekend:[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())}" :style="{width:dayWidth+'px'}"><strong>{{date.slice(5)}}</strong><small>{{['日','一','二','三','四','五','六'][new Date(date+'T12:00:00Z').getUTCDay()]}}</small></div></div>
   <div class="chart-body">
    <svg class="name-column" :width="labelWidth" :height="Math.max(layout.totalHeight,56)" aria-label="成员与任务名称">
     <rect width="100%" height="100%" fill="var(--ts-bg)"/>
     <g v-for="row in layout.rows" :key="row.key"><rect x="0" :y="row.y" :width="labelWidth" :height="row.height" :fill="row.type==='member'?'var(--ts-soft)':'var(--ts-bg)'"/><text :x="row.type==='member'?12:20" :y="row.y+21" :font-weight="row.type==='member'?600:400"><title>{{row.type==='member'?row.memberName:row.title}}</title>{{Array.from(row.type==='member'?row.memberName??'':row.title??'').slice(0,labelWidth<150?8:13).join('')}}</text></g>
    </svg>
    <svg :width="layout.totalWidth" :height="Math.max(layout.totalHeight,56)" role="group" aria-label="任务与每日工时甘特图">
     <rect width="100%" height="100%" fill="var(--ts-bg)"/>
     <g v-for="row in layout.rows.filter(row=>row.type==='member')" :key="row.key"><rect x="0" :y="row.y" :width="layout.totalWidth" :height="row.height" fill="var(--ts-soft)"/></g>
     <g v-for="(date,index) in layout.days" :key="date"><rect v-if="date===today" :x="index*dayWidth" y="0" :width="dayWidth" :height="layout.totalHeight" fill="var(--ts-selected)"/><path :d="'M'+index*dayWidth+' 0v'+layout.totalHeight" stroke="var(--ts-line)"/></g>
     <g v-for="layer in (mode==='tasks'?['hours','tasks']:['tasks','hours'])" :key="layer" :data-layer="layer" :opacity="layer===mode?1:.18" :style="{pointerEvents:layer===mode?'auto':'none'}" :aria-hidden="layer===mode?undefined:true">
      <template v-if="layer==='hours'">
       <g v-for="cell in cells" :key="cell.member.member.staffId+cell.day.date" :tabindex="mode==='hours'?0:-1" :role="mode==='hours'?'button':undefined" :aria-label="cell.member.member.name+' '+cell.day.date+' 工时 '+(cell.day.reasons.length?'部分未知':number(cell.day.total))" @click="selectDay(cell)" @keydown.enter="selectDay(cell)" @keydown.space.prevent="selectDay(cell)">
        <title v-if="mode==='hours'">{{cell.member.member.name}} {{cell.day.date}} · 实际 {{number(cell.day.actual)}} / 预计 {{number(cell.day.allocated)}} / 目标 {{number(cell.day.target)}}h{{cell.day.reasons.length?' · 含未知数据':''}}</title>
        <rect :x="cell.index*dayWidth+8" :y="cell.band.y-36+4" :width="dayWidth-16" :height="Math.max(24,cell.band.height-8)" rx="3" fill="var(--ts-soft)"/>
        <rect :x="cell.index*dayWidth+8" :y="cell.band.y-36+cell.band.height-4-cell.day.actual/maximum*(cell.band.height-12)" :width="dayWidth-16" :height="cell.day.actual/maximum*(cell.band.height-12)" fill="var(--ts-actual)"/>
        <rect :x="cell.index*dayWidth+8" :y="cell.band.y-36+cell.band.height-4-(cell.day.actual+(cell.day.basis==='forecast'?cell.day.allocated:0))/maximum*(cell.band.height-12)" :width="dayWidth-16" :height="(cell.day.basis==='forecast'?cell.day.allocated:0)/maximum*(cell.band.height-12)" fill="var(--ts-forecast)"/>
        <path :d="'M'+(cell.index*dayWidth+6)+' '+(cell.band.y-36+cell.band.height-4-cell.day.target/maximum*(cell.band.height-12))+'h'+(dayWidth-12)" stroke="var(--ts-text)" stroke-dasharray="3 3"/>
        <rect v-if="mode==='hours'" :x="cell.index*dayWidth+dayWidth/2-18" :y="cell.band.y-36+5" width="36" height="17" rx="3" fill="var(--ts-bg)" opacity=".95"/>
        <text v-if="mode==='hours'" :x="cell.index*dayWidth+dayWidth/2" :y="cell.band.y-36+18" text-anchor="middle" font-size="11">{{cell.day.reasons.length?'?':number(cell.day.total)}}h</text>
       </g>
      </template>
      <template v-else>
       <g v-for="bar in layout.bars.filter(bar=>bar.width>0)" :key="bar.key" :tabindex="mode==='tasks'?0:-1" :role="mode==='tasks'?'button':undefined" :aria-label="bar.title" @click="barTask(bar)&&selectTask(barTask(bar)!.projectId,barTask(bar)!.id,barTask(bar)!.sourceType)" @keydown.enter="barTask(bar)&&selectTask(barTask(bar)!.projectId,barTask(bar)!.id,barTask(bar)!.sourceType)" @keydown.space.prevent="barTask(bar)&&selectTask(barTask(bar)!.projectId,barTask(bar)!.id,barTask(bar)!.sourceType)">
        <title v-if="mode==='tasks'">{{bar.title}} · {{bar.startDate}} — {{bar.dueDate}} · {{bar.completed?'已完成':'未完成'}}</title>
        <rect :x="bar.x+2" :y="bar.y" :width="Math.max(1,bar.width-4)" :height="bar.height" rx="4" :fill="color(bar.color)" :stroke="bar.completed?'var(--ts-actual)':'var(--ts-text)'" :stroke-width="bar.completed?2:.6"/>
        <circle v-if="bar.completed" :cx="bar.x+10" :cy="bar.y+bar.height/2" r="5" fill="var(--ts-bg)"/><text v-if="bar.completed" :x="bar.x+6" :y="bar.y+bar.height/2+3" fill="var(--ts-actual)" font-size="10">✓</text>
       </g>
      </template>
     </g>
     <path v-if="layout.todayX!==null" :d="'M'+layout.todayX+' 0v'+layout.totalHeight" stroke="var(--ts-accent)" stroke-dasharray="4 4" pointer-events="none"/>
    </svg>
   </div>
  </div>
 </div>
 <p v-if="!members.length" class="empty">当前范围没有可展示的成员数据。</p>
 <section v-if="selectedTask" class="gantt-detail" aria-label="任务详情"><button class="close" aria-label="关闭任务详情" @click="selectedTask=undefined">×</button><h3>{{selectedTask.title}}</h3><p>{{selectedTask.projectName}} · {{selectedTask.assigneeName}} · {{selectedTask.status}}</p><p>{{selectedTask.startDate}} — {{selectedTask.dueDate}} · 预估 {{selectedTask.effort??'0（原值缺失）'}}h</p><p>花费 {{selectedTask.hours?.actual??'未知'}}h（{{selectedTask.hours?.actualCoverage==='period'?'本期间':'累计'}}） · 剩余 {{selectedTask.hours?.remaining??'未知'}}h</p><p>关联需求：{{selectedTask.storyId??'未关联'}}</p><p class="description">{{selectedTask.description}}</p><a v-if="selectedTask.tapdUrl" :href="selectedTask.tapdUrl" @click.prevent="emit('open',selectedTask.tapdUrl)">在 TAPD 中查看 ↗</a></section>
 <section v-if="selectedDay" class="gantt-detail" aria-label="每日工时详情"><button class="close" aria-label="关闭工时详情" @click="selectedDay=undefined">×</button><h3>{{selectedDay.member.member.name}} · {{selectedDay.day.date}}</h3><p>{{selectedDay.day.reasons.length?'已知实际':'实际'}} {{number(selectedDay.day.actual)}}h · 预计 {{number(selectedDay.day.allocated)}}h · 目标 {{number(selectedDay.day.target)}}h · 差额 {{selectedDay.day.reasons.length?'未知':number(selectedDay.day.deficit)+'h'}}</p><ul><li v-for="contribution in selectedDay.day.contributions" :key="contribution.taskKey">{{taskFor(contribution.taskKey)?.title??contribution.taskKey}} · 实际 {{number(contribution.actual)}} / 预计 {{number(contribution.allocated)}}h</li></ul><p v-for="(reason,index) in selectedDay.day.reasons" :key="index">{{reason.message}}</p></section>
</template>
<style scoped>
.gantt-scroll{overflow:auto;max-height:620px;border:1px solid var(--ts-line);border-radius:8px;background:var(--ts-bg);position:relative}.chart-body{display:flex;align-items:start}.gantt-scroll svg{display:block;flex-shrink:0;font:12px system-ui,sans-serif;color:var(--ts-text)}text{fill:currentColor}.name-column{position:sticky;left:0;z-index:2;box-shadow:1px 0 var(--ts-line)}.date-header{display:flex;position:sticky;top:0;z-index:3;height:48px;background:var(--ts-bg);border-bottom:1px solid var(--ts-line)}.name-header{position:sticky;left:0;z-index:4;background:var(--ts-bg);padding:14px 12px;flex-shrink:0;font-size:12px;font-weight:600;border-right:1px solid var(--ts-line)}.date{flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;border-right:1px solid var(--ts-line)}.date.weekend{background:var(--ts-soft)}.date.today{background:var(--ts-selected);color:var(--ts-accent)}.date small{font-size:10px}g[role=button]{cursor:pointer}g[role=button]:hover{filter:brightness(.94)}g[role=button]:focus-visible{outline:2px solid var(--ts-accent);outline-offset:2px}.gantt-detail{position:relative;background:var(--ts-soft);border:1px solid var(--ts-line);padding:16px;margin-top:12px;border-radius:8px;overflow-wrap:anywhere}.gantt-detail h3{padding-right:36px;margin-top:0}.close{position:absolute;right:8px;top:8px;font-size:20px;line-height:1}.description{white-space:pre-wrap}a{color:var(--ts-accent)}
</style>
