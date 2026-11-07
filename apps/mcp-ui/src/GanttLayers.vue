<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted, useId } from 'vue'
import { isWorkingDay, type WorkingCalendar, type GanttDisplayTask, type DisplaySpan, type MemberHours, type DateRange } from '@teamsight/core'
import { buildGanttModel, hoursNumber as number, statusLabel, type HoursCell } from './gantt-model'
import GanttDrawer from './GanttDrawer.vue'
import { useVisibleViewport } from './visible-viewport'
const props=defineProps<{tasks:GanttDisplayTask[];members:MemberHours[];range:DateRange;today:string;mode:'tasks'|'hours';calendar?:WorkingCalendar}>()
const emit=defineEmits<{select:[value:Record<string,unknown>];open:[url:string]}>()
const container=ref<HTMLElement>(),width=ref(760)
let observer:ResizeObserver|undefined, hoverTimer:ReturnType<typeof setTimeout>|undefined, focusTimer:ReturnType<typeof setTimeout>|undefined, tooltipGeneration=0
const labelWidth=computed(()=>width.value<540?132:190)
const dayWidth=computed(()=>Math.max(48,(width.value-labelWidth.value)/Math.max(1,Math.round((Date.parse(props.range.end)-Date.parse(props.range.start))/86400000)+1)))
const model=computed(()=>buildGanttModel(props.tasks,props.members,props.range,props.today,labelWidth.value,dayWidth.value,props.calendar))
const layout=computed(()=>model.value.layout)
const selectedSpan=ref<DisplaySpan>()
const selectedTask=ref<GanttDisplayTask>(),selectedDay=ref<HoursCell>()
const tooltip=ref<{task:GanttDisplayTask;span?:DisplaySpan;x:number;y:number}>(),tooltipElement=ref<HTMLElement>(),tooltipId=useId()
const viewport=useVisibleViewport()
const color=(value:string)=>/^#[a-f0-9]{6}$/i.test(value)?value:'#EB732D'
function hideTooltip(){clearTimeout(hoverTimer);clearTimeout(focusTimer);tooltipGeneration++;tooltip.value=undefined}
function hideOnScroll(){clearTimeout(hoverTimer);tooltipGeneration++;tooltip.value=undefined}
function closeDetail(){selectedSpan.value=undefined;selectedTask.value=undefined;selectedDay.value=undefined}
watch(()=>[props.mode,props.tasks,props.members,props.range,props.today,props.calendar],()=>{hideTooltip();closeDetail()})
async function showTooltip(task:GanttDisplayTask,event:Event,immediate=false,span?:DisplaySpan){
 hideTooltip();if(props.mode!=='tasks'||selectedTask.value||selectedDay.value)return
 const element=event.currentTarget as SVGElement
 const token=tooltipGeneration
 const show=async()=>{
  if(!element.isConnected||props.mode!=='tasks'||selectedTask.value||selectedDay.value||(immediate?document.activeElement!==element:token!==tooltipGeneration))return
  const generation=tooltipGeneration
  const anchor=element.getBoundingClientRect()
  tooltip.value={task,span,x:8,y:8};await nextTick()
  if(!tooltip.value||generation!==tooltipGeneration)return
  const bounds=tooltipElement.value?.getBoundingClientRect(),w=bounds?.width??300,h=bounds?.height??150
  const visible=viewport.value
  tooltip.value={task,span,x:Math.max(visible.left+8,Math.min(anchor.left,visible.right-w-8)),y:Math.max(visible.top+8,Math.min(anchor.bottom+8+h>visible.bottom?anchor.top-h-8:anchor.bottom+8,visible.bottom-h-8))}
 }
 // Focus can scroll the iframe or chart; position after the browser's scroll events.
 if(immediate)focusTimer=setTimeout(()=>void show(),200);else hoverTimer=setTimeout(()=>void show(),200)
}
function selectTask(task:GanttDisplayTask,event:Event,span?:DisplaySpan){
 if(props.mode!=='tasks')return
 hideTooltip();selectedDay.value=undefined;selectedTask.value=task;selectedSpan.value=span;(event.currentTarget as SVGElement).focus({preventScroll:true})
 emit('select',{kind:'task',projectId:task.projectId,id:task.id,sourceType:task.sourceType,memberId:span?.memberId,displayKind:span?.kind})
}
function selectDay(cell:HoursCell,event:Event){
 if(props.mode!=='hours')return
 hideTooltip();(event.currentTarget as SVGElement).focus({preventScroll:true});selectedTask.value=undefined;selectedDay.value=cell
 emit('select',{kind:'hours',memberId:cell.member.member.staffId,date:cell.day.date})
}
onMounted(()=>{
 if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(entries=>{width.value=entries[0]?.contentRect.width??760});if(container.value)observer.observe(container.value)}
 window.addEventListener('scroll',hideOnScroll,true);window.addEventListener('resize',hideTooltip)
})
onUnmounted(()=>{observer?.disconnect();hideTooltip();window.removeEventListener('scroll',hideOnScroll,true);window.removeEventListener('resize',hideTooltip)})
</script>
<template>
 <div ref="container" class="gantt-scroll" :data-mode="mode">
  <div class="gantt-canvas" :style="{width:layout.totalWidth+labelWidth+'px'}">
   <div class="date-header"><div class="name-header" :style="{width:labelWidth+'px'}">成员 / 任务</div><div v-for="date in layout.days" :key="date" class="date" :class="{today:date===today,rest:!isWorkingDay(date,calendar)}" :style="{width:dayWidth+'px'}"><strong>{{date.slice(5)}}</strong><small>{{['日','一','二','三','四','五','六'][new Date(date+'T12:00:00Z').getUTCDay()]}}</small></div></div>
   <div class="chart-body">
    <svg class="name-column" :width="labelWidth" :height="Math.max(layout.totalHeight,56)" aria-label="成员与任务名称">
     <rect width="100%" height="100%" fill="var(--ts-bg)"/>
     <g v-for="row in layout.rows" :key="row.key"><rect x="0" :y="row.y" :width="labelWidth" :height="row.height" :fill="row.type==='member'?'var(--ts-soft)':'var(--ts-bg)'"/><text :x="row.type==='member'?12:20" :y="row.y+21" :font-weight="row.type==='member'?600:400"><title>{{row.type==='member'?row.memberName:row.title}}</title>{{Array.from(row.type==='member'?row.memberName??'':row.title??'').slice(0,labelWidth<150?8:13).join('')}}</text></g>
    </svg>
    <svg :width="layout.totalWidth" :height="Math.max(layout.totalHeight,56)" role="group" aria-label="任务与每日工时甘特图">
     <rect width="100%" height="100%" fill="var(--ts-bg)"/>
     <g v-for="row in layout.rows.filter(row=>row.type==='member')" :key="row.key"><rect x="0" :y="row.y" :width="layout.totalWidth" :height="row.height" fill="var(--ts-soft)"/></g>
     <g v-for="(date,index) in layout.days" :key="date"><rect v-if="!isWorkingDay(date,calendar)" :data-rest-date="date" :x="index*dayWidth" y="0" :width="dayWidth" :height="Math.max(layout.totalHeight,56)" fill="var(--ts-soft)"/><rect v-else-if="date===today" :x="index*dayWidth" y="0" :width="dayWidth" :height="layout.totalHeight" fill="var(--ts-selected)"/><path :d="'M'+index*dayWidth+' 0v'+layout.totalHeight" stroke="var(--ts-line)"/></g>
     <g v-for="layer in (mode==='tasks'?['hours','tasks']:['tasks','hours'])" :key="layer" class="gantt-layer" :data-layer="layer" :style="{pointerEvents:layer===mode?'auto':'none'}" :aria-hidden="layer===mode?undefined:true">
      <template v-if="layer==='hours'">
       <g v-for="cell in model.cells" :key="cell.key" :data-cell="cell.key" :data-status="cell.status" :tabindex="mode==='hours'?0:-1" :role="mode==='hours'?'button':undefined" :aria-label="cell.member.member.name+' '+cell.day.date+' '+statusLabel[cell.status]+' '+(cell.status==='unknown'?'已知 ':'')+number(cell.day.total)+'h'" :style="{'--hours-color':`var(--ts-hours-${cell.status})`}" @click="selectDay(cell,$event)" @keydown.enter="selectDay(cell,$event)" @keydown.space.prevent="selectDay(cell,$event)">
        <title v-if="mode==='hours'">{{cell.member.member.name}} {{cell.day.date}} · {{statusLabel[cell.status]}} · 实际 {{number(cell.day.actual)}} / 预计 {{number(cell.day.allocated)}} / 目标 {{number(cell.day.target)}}h</title>
        <rect class="hours-box" :x="cell.x" :y="cell.y" :width="cell.width" :height="cell.height" rx="4" fill="var(--hours-color)" :fill-opacity="mode==='tasks'?.22:.30" :stroke-opacity="mode==='tasks'?.22:1" stroke="var(--hours-color)" stroke-width="2"/>
        <g class="hours-decoration" :opacity="mode==='tasks'?.22:1">
        <rect :x="cell.x" :y="cell.y+3" width="3" :height="Math.max(0,cell.height-6)" rx="1" fill="var(--hours-color)"/>
        <rect :x="cell.x+3" :y="cell.y+1" :width="cell.width-6" height="10" rx="2" fill="var(--ts-bg)"/>
        <text class="hours-label" :x="cell.x+cell.width/2" :y="cell.y+9" text-anchor="middle" font-size="9">{{cell.status==='unknown'?'未知':number(cell.day.total)+'h'}}</text>
        </g>
       </g>
      </template>
      <template v-else>
       <g v-for="bar in model.bars" :key="bar.key" class="task-bar" :opacity="mode==='tasks'?1:.32" :data-task="[bar.task.projectId,bar.task.sourceType,bar.task.id].join(':')" :tabindex="mode==='tasks'?0:-1" :role="mode==='tasks'?'button':undefined" :data-virtual="bar.span.kind==='actual'?true:undefined" :aria-label="bar.title+(bar.span.kind==='actual'?' · 按工时补充':'')" :aria-describedby="tooltip?.task===bar.task?tooltipId:undefined" @click="selectTask(bar.task,$event,bar.span)" @keydown.enter="selectTask(bar.task,$event,bar.span)" @keydown.space.prevent="selectTask(bar.task,$event,bar.span)" @mouseenter="showTooltip(bar.task,$event,false,bar.span)" @mouseleave="hideTooltip" @focus="showTooltip(bar.task,$event,true,bar.span)" @blur="hideTooltip" @keydown.esc="hideTooltip">
        <rect :x="bar.x+7" :y="bar.y" :width="Math.max(1,bar.width-14)" :height="bar.height" rx="4" :fill="color(bar.color)" :stroke="bar.completed?'var(--ts-actual)':'var(--ts-text)'" :stroke-width="bar.span.kind==='actual'?1.5:bar.completed?2:.6" :stroke-dasharray="bar.span.kind==='actual'?'3 2':undefined"/>
        <circle v-if="bar.completed&&bar.span.kind==='planned'" :cx="bar.x+15" :cy="bar.y+bar.height/2" r="5" fill="var(--ts-bg)"/><text v-if="bar.completed&&bar.span.kind==='planned'" :x="bar.x+11" :y="bar.y+bar.height/2+3" fill="var(--ts-actual)" font-size="10">✓</text>
        <text v-if="bar.span.kind==='actual'" class="virtual-label" :x="bar.x+bar.width/2" :y="bar.y+bar.height/2+3" text-anchor="middle" font-size="9">{{bar.width>=100?'按工时补充':'补'}}</text>
       </g>
      </template>
     </g>
     <path v-if="layout.todayX!==null" :d="'M'+layout.todayX+' 0v'+layout.totalHeight" stroke="var(--ts-accent)" stroke-dasharray="4 4" pointer-events="none"/>
    </svg>
   </div>
  </div>
 </div>
 <p v-if="!members.length" class="empty">当前范围没有可展示的成员数据。</p>
 <GanttDrawer v-if="selectedTask||selectedDay" :title="selectedTask?'任务详情':'每日工时详情'" @close="closeDetail">
  <template v-if="selectedTask"><h3>{{selectedTask.title}}</h3><p>{{selectedTask.projectName}} · 当前负责人 {{selectedTask.assigneeName}} · {{selectedTask.status}}</p><p>真实排期：{{selectedTask.startDate??'缺开始日'}} — {{selectedTask.dueDate??'缺结束日'}} · 预估 {{selectedTask.effort??'0（原值缺失）'}}h</p><p v-if="selectedSpan">{{selectedSpan.kind==='actual'?'按工时补充':'排期展示'}}：{{selectedSpan.start}} — {{selectedSpan.end}} · 填报成员 {{selectedSpan.memberName}}</p><p v-if="selectedSpan?.kind==='actual'">虚拟区间按实际投入日期补充，不代表每天都有工时。</p><p v-if="selectedTask.displayWarning" class="warning">{{selectedTask.displayWarning}}</p><ul v-if="selectedSpan?.actualDays.length"><li v-for="day in selectedSpan.actualDays" :key="day.date">{{day.date}} · 实际 {{number(day.hours)}}h</li></ul><p>花费 {{selectedTask.hours?.actual??'未知'}}h（{{selectedTask.hours?.actualCoverage==='period'?'本期间':'累计'}}） · 剩余 {{selectedTask.hours?.remaining??'未知'}}h</p><p>关联需求：{{selectedTask.storyId??'未关联'}}</p><p class="description">{{selectedTask.description}}</p><a v-if="selectedTask.tapdUrl" :href="selectedTask.tapdUrl" @click.prevent="emit('open',selectedTask.tapdUrl)">在 TAPD 中查看 ↗</a></template>
  <template v-if="selectedDay"><h3>{{selectedDay.member.member.name}} · {{selectedDay.day.date}}</h3><p class="status-message" :style="{color:`var(--ts-hours-${selectedDay.status})`}">{{statusLabel[selectedDay.status]}}</p><p>{{selectedDay.day.reasons.length?'已知实际':'实际'}} {{number(selectedDay.day.actual)}}h · 预计 {{number(selectedDay.day.allocated)}}h · 目标 {{number(selectedDay.day.target)}}h · 差额 {{selectedDay.status==='unknown'?'未知':number(selectedDay.day.deficit)+'h'}}</p><h3>关联任务</h3><ul class="related-tasks"><li v-for="related in selectedDay.related" :key="related.key"><strong>{{related.task?.title??related.key}}</strong><small>{{related.scheduled?'排期覆盖':related.virtual?'虚拟区间覆盖':''}}{{(related.scheduled||related.virtual)&&related.contribution?' · ':''}}{{related.contribution?'工时贡献':''}}</small><p v-if="related.contribution">实际 {{number(related.contribution.actual)}} / 预计 {{number(related.contribution.allocated)}}h</p><p v-else>当天无工时贡献记录</p></li></ul><p v-if="!selectedDay.related.length" class="muted">当天没有关联任务。</p><p v-for="(reason,index) in selectedDay.day.reasons" :key="index">{{reason.message}}</p></template>
 </GanttDrawer>
 <Teleport to="body"><div v-if="tooltip" :id="tooltipId" ref="tooltipElement" role="tooltip" class="task-tooltip" :style="{left:tooltip.x+'px',top:tooltip.y+'px',maxHeight:Math.max(0,viewport.bottom-viewport.top-16)+'px'}"><strong>{{tooltip.task.title}}</strong><p>{{tooltip.task.projectName}} · {{tooltip.task.assigneeName}}</p><p>{{tooltip.task.status}} · 真实排期 {{tooltip.task.startDate??'缺开始日'}} — {{tooltip.task.dueDate??'缺结束日'}}</p><p v-if="tooltip.span">{{tooltip.span.kind==='actual'?'按工时补充':'排期展示'}} {{tooltip.span.start}} — {{tooltip.span.end}} · {{tooltip.span.memberName}}</p><p v-if="tooltip.span?.actualDays.length">实际：{{tooltip.span.actualDays.map(day=>day.date+' '+number(day.hours)+'h').join('、')}}</p><p v-if="tooltip.task.displayWarning">{{tooltip.task.displayWarning}}</p><p>预估 {{tooltip.task.effort??'未知'}}h</p></div></Teleport>
</template>
<style scoped>
/* Animate inherited numbers on the stable scroller: SVG layer moves reset local transitions. */
@property --ts-gantt-task-opacity{syntax:"<number>";inherits:true;initial-value:1}
@property --ts-gantt-hours-fill{syntax:"<number>";inherits:true;initial-value:.22}
@property --ts-gantt-hours-emphasis{syntax:"<number>";inherits:true;initial-value:.22}
.gantt-scroll{--ts-gantt-task-opacity:1;--ts-gantt-hours-fill:.22;--ts-gantt-hours-emphasis:.22;transition:--ts-gantt-task-opacity 200ms ease-in-out,--ts-gantt-hours-fill 200ms ease-in-out,--ts-gantt-hours-emphasis 200ms ease-in-out}.gantt-scroll[data-mode=hours]{--ts-gantt-task-opacity:.32;--ts-gantt-hours-fill:.30;--ts-gantt-hours-emphasis:1}

.gantt-scroll{overflow:auto;max-height:620px;border:1px solid var(--ts-line);border-radius:8px;background:var(--ts-bg);position:relative}.chart-body{display:flex;align-items:start}.gantt-scroll svg{display:block;flex-shrink:0;font:12px system-ui,sans-serif;color:var(--ts-text)}text{fill:currentColor}.name-column{position:sticky;left:0;z-index:2;box-shadow:1px 0 var(--ts-line)}.date-header{display:flex;position:sticky;top:0;z-index:3;height:48px;background:var(--ts-bg);border-bottom:1px solid var(--ts-line)}.name-header{position:sticky;left:0;z-index:4;background:var(--ts-bg);padding:14px 12px;flex-shrink:0;font-size:12px;font-weight:600;border-right:1px solid var(--ts-line)}.date{flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;border-right:1px solid var(--ts-line)}.date.rest{background:var(--ts-soft)}.date.today{color:var(--ts-accent)}.date.today:not(.rest){background:var(--ts-selected)}.date small{font-size:10px}g[role=button]{cursor:pointer}g[role=button]:hover{filter:brightness(.94)}g[role=button]:focus-visible{outline:2px solid var(--ts-accent);outline-offset:2px}.virtual-label{fill:var(--ts-bg);font-weight:700;pointer-events:none}.hours-label{fill:var(--hours-color);font-weight:650}.task-bar{opacity:var(--ts-gantt-task-opacity)}.hours-decoration{opacity:var(--ts-gantt-hours-emphasis)}.hours-box{fill-opacity:var(--ts-gantt-hours-fill);stroke-opacity:var(--ts-gantt-hours-emphasis)}.description{white-space:pre-wrap}.related-tasks{list-style:none;margin:8px 0;padding:0}.related-tasks li{padding:12px 0;border-bottom:1px solid var(--ts-line)}.related-tasks small{display:block;margin-top:4px}.status-message{font-weight:650}.task-tooltip{position:fixed;z-index:10;pointer-events:none;width:320px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:hidden;background:var(--ts-bg);color:var(--ts-text);border:1px solid var(--ts-border);border-radius:8px;padding:12px;box-shadow:0 4px 16px #0002;font-size:12px;overflow-wrap:anywhere}.task-tooltip p{margin:5px 0 0}a{color:var(--ts-accent)}
</style>
