<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import GanttBoard from '@/components/gantt/GanttBoard.vue';
import { useSchedule } from '@/composables/useSchedule';
import { useSettings } from '@/composables/useSettings';
import { currentMonthRange, todayKey, type DateRange } from '@/gantt/dateUtils';
import { isTauriRuntime } from '@/services/tapd/client';
import { describeTapdError } from '@/services/credentials';
import type { ScheduleTask } from '@/types/schedule';
import { expandTasksByMember, memberKeyOf } from '@/utils/memberResolution';

import { POC_COLLAPSED_MEMBERS, POC_TASKS } from './mockData';

const CHECKLIST = [
  '成员标题行独立成行，且不显示任务条',
  '每个任务独占一行，同成员同日任务不相互遮挡',
  '日期网格与任务条横向对齐（左边界 = 开始日）',
  '左侧标题列与右侧任务行纵向对齐',
  '折叠/展开成员后，其后的行不错位',
  '横向滚动时表头与任务条同步，表头吸顶',
  '跨月任务按时间窗裁剪显示，原始日期不变',
  '项目颜色稳定，同一项目在不同成员下颜色一致',
];

const store = useSettings();
const schedule = useSchedule();

const range = ref<DateRange>(currentMonthRange());
const collapsedMemberKeys = ref<string[]>([...POC_COLLAPSED_MEMBERS]);
const selectedTaskKey = ref<string | null>(null);
const dataSource = ref<'mock' | 'live'>('mock');

const tasks = computed(() => (dataSource.value === 'mock' ? POC_TASKS : schedule.liveTasks.value));

const selectedTask = computed(() =>
  tasks.value.find((task) => `${task.sourceType}:${task.id}` === selectedTaskKey.value)
);

const mockMemberNames = computed(() => {
  const expansion = expandTasksByMember(
    POC_TASKS,
    [...new Set(POC_TASKS.filter((task) => task.assigneeId).map((task) => task.assigneeId as string))]
      .map((staffId) => ({
        staffId,
        name: POC_TASKS.find((task) => task.assigneeId === staffId)?.assigneeName ?? staffId,
      }))
  );
  return expansion.namesByMember;
});

const boardMemberKeysOf = computed<((task: ScheduleTask) => string[]) | undefined>(() =>
  dataSource.value === 'mock' ? undefined : schedule.memberKeysOf
);

const boardMemberNames = computed<Map<string, string> | undefined>(() =>
  dataSource.value === 'mock' ? mockMemberNames.value : schedule.memberNames.value
);

const mockHiddenTaskCount = 0;
const hiddenTaskCount = computed(() =>
  dataSource.value === 'mock' ? mockHiddenTaskCount : schedule.hiddenTaskCount.value
);

const unscheduledCount = computed(
  () => tasks.value.filter((task) => !task.startDate || !task.dueDate).length
);

const enabledProjectCount = computed(() => store.enabledProjects.value.length);
const canLoadLive = computed(() => isTauriRuntime() && enabledProjectCount.value > 0);

function monthRange(offsetMonths: number): DateRange {
  const now = new Date();
  return currentMonthRange(new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1));
}

function shiftMonth(offset: number): void {
  const start = new Date(`${range.value.start}T00:00:00Z`);
  range.value = currentMonthRange(
    new Date(start.getUTCFullYear(), start.getUTCMonth() + offset, 1)
  );
}

function resetMonth(): void {
  range.value = monthRange(0);
}

function toggleMember(memberKey: string): void {
  const next = new Set(collapsedMemberKeys.value);
  if (next.has(memberKey)) next.delete(memberKey);
  else next.add(memberKey);
  collapsedMemberKeys.value = [...next];
}

function selectTask(taskKey: string): void {
  selectedTaskKey.value = taskKey;
}

function useMockData(): void {
  dataSource.value = 'mock';
  schedule.statusText.value = '';
}

async function loadLiveData(): Promise<void> {
  if (!isTauriRuntime()) {
    schedule.statusText.value =
      '真实数据仅在 Tauri 客户端内可用，请使用 pnpm tauri:dev 启动。';
    return;
  }
  if (enabledProjectCount.value === 0) {
    schedule.statusText.value = '请先在设置页启用至少一个项目。';
    return;
  }
  dataSource.value = 'live';
  await schedule.refresh(store.enabledProjects.value, range.value);
}

onMounted(async () => {
  await store.load();
  if (import.meta.env.VITE_POC_AUTOLOAD === 'live') await loadLiveData();
});

// 切换时间范围后，真实数据需要重新按窗口拉取；mock 数据只重算布局。
watch(range, async () => {
  if (dataSource.value === 'live') await schedule.refresh(store.enabledProjects.value, range.value);
});

const today = todayKey();
const memberFilterHint = computed(() => {
  if (dataSource.value === 'mock') return '（固定数据不受成员过滤影响）';
  const configured = store.settings.value.members.length;
  return configured === 0
    ? '（未配置展示成员，任务全部隐藏；请到设置页添加成员）'
    : `（仅显示已配置的 ${configured} 名成员，隐藏 ${hiddenTaskCount.value} 条）`;
});

/** 供模板显示成员键 -> 用于折叠状态判断。 */
function collapseKeyOf(task: ScheduleTask): string {
  return task.assigneeId ? memberKeyOf(task.assigneeId) : 'unassigned';
}
</script>

<template>
  <div class="poc">
    <header class="poc__header">
      <div>
        <h1 class="poc__title">TeamSight · 数据接入验证</h1>
        <p class="poc__subtitle">
          阶段1 验证入口：读取设置中的项目与成员，核对部分失败提示与成员过滤。正式看板在阶段2 实现。
        </p>
      </div>
      <div class="poc__range">
        <button type="button" @click="shiftMonth(-1)">上一月</button>
        <button type="button" @click="resetMonth">本月</button>
        <button type="button" @click="shiftMonth(1)">下一月</button>
        <span class="poc__range-label">{{ range.start }} ~ {{ range.end }}</span>
      </div>
    </header>

    <section class="poc__toolbar">
      <div class="poc__group">
        <span class="poc__group-label">数据源</span>
        <button type="button" :class="{ 'is-active': dataSource === 'mock' }" @click="useMockData">
          PoC 固定数据
        </button>
        <button
          type="button"
          :class="{ 'is-active': dataSource === 'live' }"
          :disabled="schedule.loading.value"
          @click="loadLiveData"
        >
          TAPD 真实数据
        </button>
        <button
          type="button"
          :disabled="!canLoadLive || schedule.loading.value"
          @click="schedule.refresh(store.enabledProjects.value, range)"
        >
          刷新
        </button>
      </div>
      <div class="poc__group poc__group--meta">
        <span>已启用项目 {{ enabledProjectCount }}</span>
        <span>任务行 {{ tasks.length }}</span>
        <span>缺失日期 {{ unscheduledCount }}</span>
        <span v-if="schedule.lastLoadedAt.value">最近刷新 {{ schedule.lastLoadedAt.value }}</span>
      </div>
    </section>

    <p v-if="schedule.statusText.value" class="poc__status">{{ schedule.statusText.value }}</p>
    <p class="poc__hint">成员过滤{{ memberFilterHint }}</p>

    <p v-if="schedule.errors.value.length" class="poc__error">
      部分项目加载失败（其余项目数据已保留）：
      {{
        schedule.errors.value
          .map(
            (error) =>
              `${error.type} @ ${error.workspaceId}：${describeTapdError(error.status, error.message, error.workspaceId)}`
          )
          .join('；')
      }}
    </p>

    <section class="poc__board">
      <GanttBoard
        :tasks="tasks"
        :range="range"
        :collapsed-member-keys="collapsedMemberKeys"
        :selected-task-key="selectedTaskKey"
        :today="today"
        :member-keys-of="boardMemberKeysOf"
        :member-names="boardMemberNames"
        @toggle-member="toggleMember"
        @select-task="selectTask"
      />
    </section>

    <section class="poc__footer">
      <div class="poc__selected">
        <span class="poc__group-label">当前选中</span>
        <template v-if="selectedTask">
          <strong>[{{ selectedTask.projectName }}] {{ selectedTask.title }}</strong>
          <span>负责人：{{ selectedTask.assigneeName || '未分配' }}</span>
          <span>状态：{{ selectedTask.status || '未知' }}</span>
          <span>日期：{{ selectedTask.startDate ?? '无' }} ~ {{ selectedTask.dueDate ?? '无' }}</span>
          <a :href="selectedTask.tapdUrl" target="_blank" rel="noreferrer">打开 TAPD</a>
        </template>
        <span v-else class="poc__muted">
          点击任务条或任务标题查看（详情面板在阶段3 实现）；
          折叠键示例：{{ collapseKeyOf(POC_TASKS[0]) }}
        </span>
      </div>

      <details class="poc__checklist">
        <summary>视觉效果验收清单</summary>
        <ul>
          <li v-for="item in CHECKLIST" :key="item">{{ item }}</li>
        </ul>
      </details>
    </section>
  </div>
</template>

<style scoped>
.poc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 12px 16px 16px;
}

.poc__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.poc__title {
  margin: 0;
  font-size: 16px;
}

.poc__subtitle {
  margin: 4px 0 0;
  color: var(--ts-color-text-muted);
}

.poc__range {
  display: flex;
  align-items: center;
  gap: 6px;
}

.poc__range-label {
  color: var(--ts-color-text-muted);
}

.poc__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--ts-color-border);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
}

.poc__group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.poc__group--meta {
  color: var(--ts-color-text-muted);
}

.poc__group-label {
  color: var(--ts-color-text-muted);
}

button {
  padding: 3px 10px;
  border: 1px solid var(--ts-color-border-strong);
  border-radius: 4px;
  background: var(--ts-color-surface);
  color: var(--ts-color-text);
  font-size: 12px;
  cursor: pointer;
}

button.is-active {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #1d4ed8;
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

.poc__status,
.poc__hint {
  margin: 0;
  color: var(--ts-color-text-muted);
}

.poc__error {
  margin: 0;
  padding: 6px 10px;
  border: 1px solid #f3d19b;
  border-radius: var(--ts-radius);
  background: #fff8ec;
  color: var(--ts-color-warning);
}

.poc__board {
  flex: 1 1 auto;
  min-height: 240px;
}

.poc__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 10px;
  border: 1px solid var(--ts-color-border);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
}

.poc__selected {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.poc__muted {
  color: var(--ts-color-text-muted);
}

.poc__checklist {
  color: var(--ts-color-text-muted);
}

.poc__checklist ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
</style>
