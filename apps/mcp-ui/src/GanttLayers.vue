<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { computeLayout, type ScheduleTask, type MemberHours, type DateRange, type DailyHours } from '@teamsight/core'
const props=defineProps<{tasks:ScheduleTask[];members:MemberHours[];range:DateRange;today:string;mode:'tasks'|'hours'}>()
const emit=defineEmits<{select:[value:Record<string,unknown>];open:[url:string]}>()
const selectedTask=ref<ScheduleTask>(),selectedDay=ref<{member:MemberHours;day:DailyHours}>()
watch(()=>props.mode,()=>{selectedTask.value=undefined;selectedDay.value=undefined})
const scheduled=computed(()=>props.tasks.filter(task=>task.startDate&&task.dueDate&&task.startDate<=task.dueDate&&task.startDate<=props.range.end&&task.dueDate>=props.range.start))
const chartTasks=computed(()=>[...scheduled.value,...props.members.filter(member=>!scheduled.value.some(task=>task.assigneeIds.includes(member.member.staffId))).map(member=>({id:'idle:'+member.member.staffId,sourceType:'task',title:'无已排期任务',projectId:'',projectName:'',projectColor:'#ccc',assigneeId:member.member.staffId,assigneeIds:[member.member.staffId],assigneeName:member.member.name,startDate:null,dueDate:null,status:'',tapdUrl:''} as ScheduleTask))])
const layout=computed(()=>computeLayout({tasks:chartTasks.value,range:props.range,today:props.today,memberOrder:props.members.map(member=>'staff:'+member.member.staffId),memberNames:new Map(props.members.map(member=>['staff:'+member.member.staffId,member.member.name])),memberKeysOf:task=>task.assigneeIds.filter(id=>props.members.some(member=>member.member.staffId===id)).map(id=>'staff:'+id)}))
const bands=computed(()=>layout.value.rows.filter(row=>row.type==='member').map((row,index,rows)=>({row,member:props.members.find(member=>'staff:'+member.member.staffId===row.memberKey),y:row.y+36,height:(rows[index+1]?.y??layout.value.totalHeight)-row.y})))
const cells=computed(()=>bands.value.flatMap(band=>band.member?.days.filter(day=>day.date>=props.range.start&&day.date<=props.range.end).map(day=>({band,member:band.member!,day,index:layout.value.days.indexOf(day.date)}))??[]))
const maximum=computed(()=>Math.max(1,...cells.value.flatMap(cell=>[cell.day.total,cell.day.target])))
const color=(value:string)=>/^#[a-f0-9]{6}$/i.test(value)?value:'#167d7f'
const taskFor=(key:string)=>props.tasks.find(task=>[task.projectId,task.sourceType,task.id].join(':')===key)
const number=(value:number)=>String(Math.floor((value+1e-9)*100)/100)
function selectTask(projectId:string,id:string) {if(props.mode!=='tasks')return;selectedTask.value=props.tasks.find(task=>task.id===id&&task.projectId===projectId);selectedDay.value=undefined;if(selectedTask.value)emit('select',{kind:'task',projectId,id})}
function selectDay(cell:typeof cells.value[number]) {if(props.mode!=='hours')return;selectedDay.value={member:cell.member,day:cell.day};selectedTask.value=undefined;emit('select',{kind:'hours',memberId:cell.member.member.staffId,date:cell.day.date})}
function barTask(bar:{taskId:string;projectId:string}) {return chartTasks.value.find(task=>task.sourceType+':'+task.id===bar.taskId&&task.projectId===bar.projectId)}
</script>
<template>
  <div class="gantt-scroll" :data-mode="mode">
    <svg :width="layout.totalWidth+280" :height="Math.max(layout.totalHeight,48)+44" role="group" aria-label="任务与每日工时甘特图">
      <rect width="100%" height="100%" fill="white"/>
      <g v-for="(date,index) in layout.days" :key="date"><text :x="284+index*40" y="23" font-size="10">{{date.slice(5)}}</text><path :d="'M'+(280+index*40)+' 35v'+layout.totalHeight" stroke="#dfe7ed"/></g>
      <g v-for="row in layout.rows" :key="row.key"><rect x="0" :y="row.y+36" :width="layout.totalWidth+280" :height="row.height" :fill="row.type==='member'?'#edf5f6':'transparent'"/><text x="12" :y="row.y+57">{{row.type==='member'?row.memberName:Array.from(row.title).slice(0,17).join('')}}</text></g>
      <g v-for="layer in (mode==='tasks'?['hours','tasks']:['tasks','hours'])" :key="layer" :data-layer="layer" :opacity="layer===mode?1:.18" :style="{pointerEvents:layer===mode?'auto':'none'}" :aria-hidden="layer===mode?undefined:true">
        <template v-if="layer==='hours'">
          <g v-for="cell in cells" :key="cell.member.member.staffId+cell.day.date" :tabindex="mode==='hours'?0:-1" :role="mode==='hours'?'button':undefined" :aria-label="cell.member.member.name+' '+cell.day.date+' 工时 '+number(cell.day.total)" @click="selectDay(cell)" @keydown.enter="selectDay(cell)">
            <title v-if="mode==='hours'">{{cell.member.member.name}} {{cell.day.date}} · 实际 {{number(cell.day.actual)}} / 预计 {{number(cell.day.allocated)}} / 目标 {{number(cell.day.target)}}h</title>
            <rect :x="286+cell.index*40" :y="cell.band.y+26" width="28" :height="Math.max(24,cell.band.height-30)" fill="#edf3f7"/>
            <rect :x="286+cell.index*40" :y="cell.band.y+cell.band.height-4-cell.day.actual/maximum*(cell.band.height-30)" width="28" :height="cell.day.actual/maximum*(cell.band.height-30)" fill="#21866c"/>
            <rect :x="286+cell.index*40" :y="cell.band.y+cell.band.height-4-(cell.day.actual+(cell.day.basis==='forecast'?cell.day.allocated:0))/maximum*(cell.band.height-30)" width="28" :height="(cell.day.basis==='forecast'?cell.day.allocated:0)/maximum*(cell.band.height-30)" fill="#478fd0"/>
            <text v-if="mode==='hours'" :x="286+cell.index*40" :y="cell.band.y+cell.band.height-7" font-size="10">{{cell.day.reasons.length?'?':number(cell.day.total)}}</text>
          </g>
        </template>
        <template v-else>
          <g v-for="bar in layout.bars.filter(bar=>bar.width>0)" :key="bar.key" :tabindex="mode==='tasks'?0:-1" :role="mode==='tasks'?'button':undefined" :aria-label="bar.title" @click="barTask(bar)&&selectTask(barTask(bar)!.projectId,barTask(bar)!.id)" @keydown.enter="barTask(bar)&&selectTask(barTask(bar)!.projectId,barTask(bar)!.id)">
            <title v-if="mode==='tasks'">{{bar.title}} · {{bar.startDate}} — {{bar.dueDate}} · {{bar.completed?'已完成':'未完成'}}</title>
            <rect :x="bar.x+280" :y="bar.y+36" :width="bar.width" :height="bar.height" rx="4" :fill="color(bar.color)" :stroke="bar.completed?'#1b584a':'none'"/>
            <text v-if="bar.completed" :x="bar.x+283" :y="bar.y+50" fill="white" font-size="11">✓</text>
          </g>
        </template>
      </g>
    </svg>
  </div>
  <section v-if="selectedTask" class="gantt-detail" aria-label="任务详情"><h3>{{selectedTask.title}}</h3><p>{{selectedTask.projectName}} · {{selectedTask.assigneeName}} · {{selectedTask.status}}</p><p>{{selectedTask.startDate}} — {{selectedTask.dueDate}} · 预估 {{selectedTask.effort??'0（原值缺失）'}}h</p><p>花费 {{selectedTask.hours?.actual??'未知'}}h（{{selectedTask.hours?.actualCoverage==='period'?'本期间':'累计'}}） · 剩余 {{selectedTask.hours?.remaining??'未知'}}h</p><p>关联需求：{{selectedTask.storyId??'未关联'}}</p><p>{{selectedTask.description}}</p><a v-if="selectedTask.tapdUrl" :href="selectedTask.tapdUrl" @click.prevent="emit('open',selectedTask.tapdUrl)">TAPD 任务</a></section>
  <section v-if="selectedDay" class="gantt-detail" aria-label="每日工时详情"><h3>{{selectedDay.member.member.name}} · {{selectedDay.day.date}}</h3><p>实际 {{number(selectedDay.day.actual)}}h · 预计 {{number(selectedDay.day.allocated)}}h · 目标 {{number(selectedDay.day.target)}}h · 差额 {{number(selectedDay.day.deficit)}}h</p><ul><li v-for="contribution in selectedDay.day.contributions" :key="contribution.taskKey">{{taskFor(contribution.taskKey)?.title??contribution.taskKey}} · 实际 {{number(contribution.actual)}} / 预计 {{number(contribution.allocated)}}h</li></ul><p v-for="(reason,index) in selectedDay.day.reasons" :key="index">{{reason.message}}</p></section>
</template>
<style scoped>
.gantt-scroll{overflow:auto;border:1px solid #dce6eb;border-radius:8px;background:white}.gantt-scroll svg{display:block;font:12px system-ui,sans-serif}g[role=button]{cursor:pointer}g[role=button]:focus{outline:2px solid #193e6b}.gantt-detail{background:white;border:1px solid #dce6eb;padding:16px;margin-top:12px;border-radius:8px}a{color:#167d7f}
</style>
