<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import GanttBoard from '@/components/gantt/GanttBoard.vue';
import { currentMonthRange, todayKey } from '@/gantt/dateUtils';
import { fetchScheduleTasks, isTauriRuntime } from '@/services/tapd/client';
import type { ProjectConfig, ScheduleTask } from '@/types/schedule';

import { POC_COLLAPSED_MEMBERS, POC_TASKS } from './mockData';

const PROJECT_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#6366f1',
];

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

const range = ref(currentMonthRange());
const collapsedMemberKeys = ref<string[]>([...POC_COLLAPSED_MEMBERS]);
const selectedTaskKey = ref<string | null>(null);
const dataSource = ref<'mock' | 'live'>('mock');
const liveTasks = ref<ScheduleTask[]>([]);
const workspaceIdsInput = ref('63253157,62120799');
const loading = ref(false);
const message = ref('');
const fetchErrors = ref<string[]>([]);

const tasks = computed(() => (dataSource.value === 'mock' ? POC_TASKS : liveTasks.value));

const selectedTask = computed(() =>
  tasks.value.find((task) => `${task.sourceType}:${task.id}` === selectedTaskKey.value)
);

const unscheduledCount = computed(
  () => tasks.value.filter((task) => !task.startDate || !task.dueDate).length
);

function monthRange(offsetMonths: number) {
  const now = new Date();
  return currentMonthRange(new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1));
}

function shiftMonth(offset: number): void {
  const start = new Date(`${range.value.start}T00:00:00Z`);
  const shifted = currentMonthRange(
    new Date(start.getUTCFullYear(), start.getUTCMonth() + offset, 1)
  );
  range.value = shifted;
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

function parseWorkspaceIds(): string[] {
  return workspaceIdsInput.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildLiveProjects(): ProjectConfig[] {
  return parseWorkspaceIds().map((id, index) => ({
    id,
    name: `项目 ${id}`,
    enabled: true,
    color: PROJECT_PALETTE[index % PROJECT_PALETTE.length],
  }));
}

async function loadLiveData(): Promise<void> {
  if (!isTauriRuntime()) {
    message.value = '真实数据仅在 Tauri 客户端内可用，请使用 pnpm tauri:dev 启动。';
    return;
  }

  const projects = buildLiveProjects();
  if (projects.length === 0) {
    message.value = '请先填写 workspace_id。';
    return;
  }

  loading.value = true;
  fetchErrors.value = [];
  message.value = '正在拉取 TAPD 数据…';
  try {
    const result = await fetchScheduleTasks({
      projects,
      range: range.value,
      types: ['task', 'bug'],
    });
    liveTasks.value = result.tasks;
    fetchErrors.value = result.errors.map(
      (error) => `${error.workspaceId} / ${error.type}：${error.message}`
    );
    dataSource.value = 'live';
    message.value = `已加载 ${result.tasks.length} 条工作项（${range.value.start} ~ ${range.value.end}）`;
  } catch (error) {
    message.value = `加载失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    loading.value = false;
  }
}

function useMockData(): void {
  dataSource.value = 'mock';
  message.value = '当前展示 PoC 固定数据。';
  fetchErrors.value = [];
}

const today = todayKey();

// 阶段性验证钩子：VITE_POC_AUTOLOAD=live 时启动即拉取真实数据，
// 便于在桌面端自动核对「前端 invoke → Rust → TAPD」链路。默认关闭。
onMounted(() => {
  if (import.meta.env.VITE_POC_AUTOLOAD === 'live') void loadLiveData();
});
</script>

<template>
  <div class="poc">
    <header class="poc__header">
      <div>
        <h1 class="poc__title">TeamSight · 阶段0 甘特图 PoC</h1>
        <p class="poc__subtitle">
          验证成员分组布局、折叠展开、滚动对齐与 TAPD 数据接入。完整看板功能在阶段2/3 实现。
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
        <button
          type="button"
          :class="{ 'is-active': dataSource === 'mock' }"
          @click="useMockData"
        >
          PoC 固定数据
        </button>
        <button
          type="button"
          :class="{ 'is-active': dataSource === 'live' }"
          :disabled="loading"
          @click="loadLiveData"
        >
          TAPD 真实数据
        </button>
        <input
          v-model="workspaceIdsInput"
          class="poc__input"
          aria-label="workspace_id 列表"
          placeholder="workspace_id，逗号分隔"
        />
      </div>
      <div class="poc__group poc__group--meta">
        <span>任务行 {{ tasks.length }}</span>
        <span>缺失日期 {{ unscheduledCount }}</span>
        <span v-if="message">{{ message }}</span>
      </div>
    </section>

    <p v-if="fetchErrors.length" class="poc__error">
      部分项目加载失败（其余项目数据已保留）：{{ fetchErrors.join('；') }}
    </p>

    <section class="poc__board">
      <GanttBoard
        :tasks="tasks"
        :range="range"
        :collapsed-member-keys="collapsedMemberKeys"
        :selected-task-key="selectedTaskKey"
        :today="today"
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
        <span v-else class="poc__muted">点击任务条或任务标题查看（详情面板在阶段3 实现）</span>
      </div>

      <details class="poc__checklist">
        <summary>阶段0 视觉验收清单</summary>
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
  gap: 10px;
  height: 100%;
  padding: 14px 16px 16px;
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

.poc__input {
  width: 220px;
  padding: 3px 6px;
  border: 1px solid var(--ts-color-border-strong);
  border-radius: 4px;
  font-size: 12px;
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
