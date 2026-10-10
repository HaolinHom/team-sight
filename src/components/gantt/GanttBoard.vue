<script setup lang="ts">
import { computed, ref } from 'vue';

import { isWeekend, todayKey, type DateRange } from '@/gantt/dateUtils';
import { computeLayout } from '@/gantt/layout';
import { buildTooltipContent, type GanttTooltipContent } from '@/gantt/tooltip';
import type { ScheduleTask } from '@/types/schedule';
import type { GanttBar } from '@/gantt/types';
import '@/styles/gantt.css';

const props = withDefaults(
  defineProps<{
    tasks: ScheduleTask[];
    range: DateRange;
    collapsedMemberKeys?: string[];
    selectedTaskKey?: string | null;
    today?: string;
    /** 任务归属成员键（多负责人任务可返回多个键 → 在多个成员分组下各占一行）。 */
    memberKeysOf?: (task: ScheduleTask) => string[];
    /** 成员键 -> 展示名。 */
    memberNames?: Map<string, string>;
  }>(),
  {
    collapsedMemberKeys: () => [],
    selectedTaskKey: null,
    today: undefined,
    memberKeysOf: undefined,
    memberNames: undefined,
  }
);

const emit = defineEmits<{
  (event: 'toggle-member', memberKey: string): void;
  (event: 'select-task', taskKey: string): void;
}>();

const timelineRef = ref<HTMLElement | null>(null);
const viewportOffset = ref(0);

interface TooltipState {
  content: GanttTooltipContent;
  x: number;
  y: number;
  below: boolean;
}

const TOOLTIP_HALF_WIDTH = 170;
const TOOLTIP_FLIP_THRESHOLD = 160;

const tooltip = ref<TooltipState | null>(null);

const layout = computed(() =>
  computeLayout({
    tasks: props.tasks,
    range: props.range,
    collapsedMemberKeys: props.collapsedMemberKeys,
    today: props.today ?? todayKey(),
    memberKeysOf: props.memberKeysOf,
    memberNames: props.memberNames,
  })
);

const columns = computed(() =>
  layout.value.days.map((day, index) => ({
    key: day,
    label: String(Number(day.slice(8, 10))),
    monthLabel: day.endsWith('-01') ? `${Number(day.slice(5, 7))}月` : '',
    x: index * layout.value.config.dayColumnWidth,
    width: layout.value.config.dayColumnWidth,
    weekend: isWeekend(day),
    today: day === (props.today ?? todayKey()),
  }))
);

const rowLines = computed(() =>
  layout.value.rows.map((row) => ({
    key: row.key,
    y: row.y + row.height,
    strong: row.type === 'member',
  }))
);

const taskIndex = computed(() => {
  const index = new Map<string, ScheduleTask>();
  for (const task of props.tasks) index.set(`${task.sourceType}:${task.id}`, task);
  return index;
});

const collapsedSet = computed(() => new Set(props.collapsedMemberKeys));

function taskOf(taskKey: string): ScheduleTask | undefined {
  return taskIndex.value.get(taskKey);
}

function barLabel(taskKey: string, width: number): string {
  const task = taskOf(taskKey);
  if (!task || width < 36) return '';
  const maxChars = Math.max(1, Math.floor((width - 12) / 12));
  if (task.title.length <= maxChars) return task.title;
  return `${task.title.slice(0, Math.max(1, maxChars - 1))}…`;
}

function dateTagOf(taskKey: string): string {
  const task = taskOf(taskKey);
  if (!task) return '';
  if (!task.startDate && !task.dueDate) return '无日期';
  if (!task.startDate) return '仅截止日';
  if (!task.dueDate) return '仅开始日';
  if (task.startDate > task.dueDate) return '日期倒挂';
  return '';
}

function onTimelineScroll(): void {
  viewportOffset.value = timelineRef.value?.scrollTop ?? 0;
}

function onLabelsWheel(event: WheelEvent): void {
  const timeline = timelineRef.value;
  if (!timeline) return;
  timeline.scrollTop += event.deltaY;
  viewportOffset.value = timeline.scrollTop;
  event.preventDefault();
}

/** 提示贴近视口边缘时向内侧收，光标靠近顶部时翻到下方显示。 */
function clampTooltipX(clientX: number): number {
  if (typeof window === 'undefined') return clientX;
  const min = TOOLTIP_HALF_WIDTH + 8;
  const max = Math.max(min, window.innerWidth - TOOLTIP_HALF_WIDTH - 8);
  return Math.min(Math.max(clientX, min), max);
}

function updateTooltip(bar: GanttBar, event: MouseEvent): void {
  const task = taskOf(bar.taskId);
  if (!task) return;
  tooltip.value = {
    content: buildTooltipContent(task, {
      clippedStart: bar.clippedStart,
      clippedEnd: bar.clippedEnd,
    }),
    x: clampTooltipX(event.clientX),
    y: event.clientY,
    below: event.clientY < TOOLTIP_FLIP_THRESHOLD,
  };
}

function hideTooltip(): void {
  tooltip.value = null;
}
</script>

<template>
  <div class="gantt">
    <div class="gantt__labels" :style="{ width: `${layout.config.labelColumnWidth}px` }">
      <div class="gantt__labels-header" :style="{ height: `${layout.config.headerHeight}px` }">
        成员 / 任务
      </div>
      <div class="gantt__labels-viewport" @wheel="onLabelsWheel">
        <div
          class="gantt__labels-body"
          :style="{
            height: `${layout.totalHeight}px`,
            transform: `translateY(-${viewportOffset}px)`,
          }"
        >
          <div
            v-for="row in layout.rows"
            :key="row.key"
            class="gantt__label-row"
            :class="row.type === 'member' ? 'gantt__label-row--member' : 'gantt__label-row--task'"
            :data-row-type="row.type"
            :data-row-key="row.key"
            :style="{ top: `${row.y}px`, height: `${row.height}px` }"
          >
            <template v-if="row.type === 'member'">
              <button
                class="gantt__caret"
                type="button"
                :aria-label="collapsedSet.has(row.memberKey) ? '展开成员' : '折叠成员'"
                @click="emit('toggle-member', row.memberKey)"
              >
                {{ collapsedSet.has(row.memberKey) ? '▶' : '▼' }}
              </button>
              <span class="gantt__member-name">{{ row.memberName }}</span>
              <span class="gantt__member-count">{{ row.taskCount }}</span>
            </template>
            <template v-else>
              <span
                v-if="taskOf(row.taskId)"
                class="gantt__task-title"
                :title="taskOf(row.taskId)?.title"
                @click="emit('select-task', row.taskId)"
              >
                [{{ taskOf(row.taskId)?.projectName }}] {{ row.title }}
              </span>
              <span v-if="dateTagOf(row.taskId)" class="gantt__task-tag">
                {{ dateTagOf(row.taskId) }}
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div ref="timelineRef" class="gantt__timeline" @scroll="onTimelineScroll">
      <div
        class="gantt__timeline-inner"
        :style="{
          width: `${layout.totalWidth}px`,
          height: `${layout.config.headerHeight + layout.totalHeight}px`,
        }"
      >
        <div
          class="gantt__timeline-header"
          :style="{ height: `${layout.config.headerHeight}px` }"
        >
          <div
            v-for="column in columns"
            :key="column.key"
            class="gantt__day"
            :class="{
              'gantt__day--weekend': column.weekend,
              'gantt__day--today': column.today,
            }"
            :style="{ left: `${column.x}px`, width: `${column.width}px` }"
          >
            <span v-if="column.monthLabel" class="gantt__day-month">{{ column.monthLabel }}</span>
            <span class="gantt__day-number">{{ column.label }}</span>
          </div>
        </div>

        <svg
          class="gantt__svg"
          :width="layout.totalWidth"
          :height="layout.totalHeight"
          :viewBox="`0 0 ${layout.totalWidth} ${layout.totalHeight}`"
          role="img"
          aria-label="团队成员排期甘特图"
        >
          <g>
            <rect
              v-for="column in columns.filter((item) => item.weekend)"
              :key="`weekend-${column.key}`"
              :x="column.x"
              y="0"
              :width="column.width"
              :height="layout.totalHeight"
              fill="#f7f8fa"
            />
          </g>

          <g>
            <line
              v-for="line in rowLines"
              :key="`row-${line.key}`"
              x1="0"
              :y1="line.y"
              :x2="layout.totalWidth"
              :y2="line.y"
              :stroke="line.strong ? '#c9ccd4' : '#eceef2'"
              stroke-width="1"
            />
            <line
              v-for="column in columns"
              :key="`col-${column.key}`"
              :x1="column.x"
              y1="0"
              :x2="column.x"
              :y2="layout.totalHeight"
              stroke="#eceef2"
              stroke-width="1"
            />
          </g>

          <g v-if="layout.todayX !== null">
            <line
              :x1="layout.todayX"
              y1="0"
              :x2="layout.todayX"
              :y2="layout.totalHeight"
              stroke="#e5484d"
              stroke-width="1.5"
              stroke-dasharray="4 3"
            />
          </g>

          <g>
            <rect
              v-for="bar in layout.bars"
              :key="bar.key"
              class="gantt__bar"
              :data-task-key="bar.taskId"
              :x="bar.x + 1"
              :y="bar.y"
              :width="Math.max(2, bar.width - 2)"
              :height="bar.height"
              rx="4"
              :fill="bar.color"
              :fill-opacity="bar.completed ? 0.35 : 1"
              :stroke="props.selectedTaskKey === bar.taskId ? '#1f2329' : 'transparent'"
              stroke-width="2"
              @click="emit('select-task', bar.taskId)"
              @mouseenter="updateTooltip(bar, $event)"
              @mousemove="updateTooltip(bar, $event)"
              @mouseleave="hideTooltip"
            />
            <text
              v-for="bar in layout.bars"
              :key="`label-${bar.key}`"
              class="gantt__bar-label"
              :x="bar.x + 8"
              :y="bar.y + bar.height / 2 + 4"
              :fill="bar.completed ? '#475569' : '#ffffff'"
            >
              {{ barLabel(bar.taskId, bar.width) }}
            </text>
          </g>
        </svg>
      </div>
    </div>

    <div
      v-if="tooltip"
      class="gantt__tooltip"
      :class="{ 'gantt__tooltip--below': tooltip.below }"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      role="tooltip"
    >
      <p class="gantt__tooltip-title">{{ tooltip.content.title }}</p>
      <dl class="gantt__tooltip-fields">
        <div><dt>项目</dt><dd>{{ tooltip.content.project }}</dd></div>
        <div><dt>负责人</dt><dd>{{ tooltip.content.assignee }}</dd></div>
        <div>
          <dt>状态</dt>
          <dd>{{ tooltip.content.status }}{{ tooltip.content.completed ? '（已完成）' : '' }}</dd>
        </div>
        <div v-if="tooltip.content.priority"><dt>优先级</dt><dd>{{ tooltip.content.priority }}</dd></div>
        <div v-if="tooltip.content.effort"><dt>预估工时</dt><dd>{{ tooltip.content.effort }}</dd></div>
        <div><dt>日期</dt><dd>{{ tooltip.content.dateRange }}</dd></div>
      </dl>
      <p v-for="note in tooltip.content.notes" :key="note" class="gantt__tooltip-note">
        {{ note }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.gantt__day {
  flex-direction: column;
}

.gantt__day-month {
  position: absolute;
  top: 3px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: var(--ts-color-text-muted);
}

.gantt__day-number {
  margin-top: 8px;
}
</style>
