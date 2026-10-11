<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import GanttBoard from '@/components/gantt/GanttBoard.vue';
import FilterPanel from '@/components/board/FilterPanel.vue';
import { useCredentials } from '@/composables/useCredentials';
import { useSchedule } from '@/composables/useSchedule';
import { useSettings } from '@/composables/useSettings';
import {
  GANTT_FIXTURE_COLLAPSED_MEMBERS,
  GANTT_FIXTURE_PROJECTS,
  GANTT_FIXTURE_TASKS,
  createStressFixtureProjects,
  createStressFixtureTasks,
} from '@/fixtures/ganttFixture';
import { resolveBoardState } from '@/gantt/boardState';
import { currentMonthRange, todayKey, type DateRange } from '@/gantt/dateUtils';
import {
  collectStatusOptions,
  createDefaultFilters,
  filterTasks,
  type ScheduleFilters,
} from '@/gantt/filters';
import { describeTapdError } from '@/services/credentials';
import { openExternalUrl } from '@/services/externalLink';
import { isTauriRuntime } from '@/services/tapd/client';
import type { MemberEntry } from '@/types/settings';
import { createMemberResolution, membersFromTasks, selectMembersByKeys } from '@/utils/memberResolution';

/**
 * 固定数据模式：`1` 为视觉验收数据，`stress` 为性能压测数据（约 2000 条）。
 * 两种模式都不请求 TAPD，也不要求凭据与配置。
 */
const FIXTURE_KIND = import.meta.env.VITE_BOARD_FIXTURE;
const FIXTURE_MODE = FIXTURE_KIND === '1' || FIXTURE_KIND === 'stress';
const FIXTURE_TASKS = FIXTURE_KIND === 'stress' ? createStressFixtureTasks() : GANTT_FIXTURE_TASKS;
const FIXTURE_PROJECTS =
  FIXTURE_KIND === 'stress' ? createStressFixtureProjects() : GANTT_FIXTURE_PROJECTS;
const SETTINGS_LINK_STATES = new Set(['no-credential', 'no-projects', 'no-members']);

const store = useSettings();
const schedule = useSchedule();
const credentials = useCredentials();

const isDesktop = isTauriRuntime();
const filters = ref<ScheduleFilters>(createDefaultFilters(currentMonthRange()));
const collapsedMemberKeys = ref<string[]>(
  FIXTURE_MODE ? [...GANTT_FIXTURE_COLLAPSED_MEMBERS] : []
);
const selectedTaskKey = ref<string | null>(null);
const externalLinkError = ref('');

const range = computed<DateRange>(() => filters.value.range);

/** 数据源：fixture 用固定验收数据，真实模式用阶段1 拉取结果。 */
const rawTasks = computed(() => (FIXTURE_MODE ? FIXTURE_TASKS : schedule.liveTasks.value));
const projectSource = computed(() => (FIXTURE_MODE ? FIXTURE_PROJECTS : store.enabledProjects.value));
const memberSource = computed<MemberEntry[]>(() =>
  FIXTURE_MODE ? membersFromTasks(FIXTURE_TASKS) : store.settings.value.members
);

const statusOptions = computed(() => collectStatusOptions(rawTasks.value));
const selectedMembers = computed(() =>
  selectMembersByKeys(memberSource.value, filters.value.memberKeys)
);
const filteredTasks = computed(() => filterTasks(rawTasks.value, filters.value));
const resolution = computed(() => createMemberResolution(filteredTasks.value, selectedMembers.value));

const tasks = computed(() => filteredTasks.value);
const boardMemberKeysOf = computed(() => resolution.value.memberKeysOf);
const boardMemberNames = computed(() => resolution.value.memberNames);

/** fixture 模式下列表来自固定数据，真实模式下来自设置页已启用项目。 */
const enabledProjectCount = computed(() => projectSource.value.length);

const canAutoLoad = computed(
  () =>
    isDesktop &&
    !FIXTURE_MODE &&
    credentials.status.value.configured &&
    enabledProjectCount.value > 0
);

const boardState = computed(() =>
  resolveBoardState({
    loading: schedule.loading.value,
    fixtureMode: FIXTURE_MODE,
    isDesktop,
    credentialConfigured: credentials.status.value.configured,
    enabledProjectCount: enabledProjectCount.value,
    memberCount: memberSource.value.length,
    taskCount: tasks.value.length,
    loadedTaskCount: rawTasks.value.length,
  })
);

const selectedTask = computed(() =>
  tasks.value.find((task) => `${task.sourceType}:${task.id}` === selectedTaskKey.value)
);

const unscheduledCount = computed(
  () => tasks.value.filter((task) => !task.startDate || !task.dueDate).length
);

/** 同一原因（如凭据失效）只提示一次，避免按项目重复刷屏。 */
const errorMessages = computed(() => {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const error of schedule.errors.value) {
    const text = describeTapdError(error.status, error.message, error.workspaceId);
    if (seen.has(text)) continue;
    seen.add(text);
    messages.push(`${error.type} @ ${error.workspaceId}：${text}`);
  }
  return messages;
});

function toggleMember(memberKey: string): void {
  const next = new Set(collapsedMemberKeys.value);
  if (next.has(memberKey)) next.delete(memberKey);
  else next.add(memberKey);
  collapsedMemberKeys.value = [...next];
}

function selectTask(taskKey: string): void {
  selectedTaskKey.value = taskKey;
}

/** 桌面端需要显式调用系统打开能力；浏览器保留原生新标签行为。 */
async function openTapdLink(event: MouseEvent): Promise<void> {
  const url = selectedTask.value?.tapdUrl;
  if (!url || !isTauriRuntime()) return;

  event.preventDefault();
  externalLinkError.value = '';
  try {
    await openExternalUrl(url);
  } catch (error) {
    externalLinkError.value = `打开 TAPD 失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function refresh(): Promise<void> {
  if (!canAutoLoad.value) return;
  await schedule.refresh(store.enabledProjects.value, filters.value.range);
}

onMounted(async () => {
  await store.load();
  if (!FIXTURE_MODE) await credentials.refresh();
  await refresh();
});

// 只有时间范围变化才重新拉取；项目/成员/状态筛选只作用于已获取数据。
watch(
  () => `${filters.value.range.start}~${filters.value.range.end}`,
  () => {
    void refresh();
  }
);

const today = todayKey();
</script>

<template>
  <div class="board">
    <FilterPanel
      v-model="filters"
      :projects="projectSource"
      :members="memberSource"
      :status-options="statusOptions"
    />

    <header class="board__toolbar">
      <div class="board__group board__group--meta">
        <button type="button" :disabled="!canAutoLoad || schedule.loading.value" @click="refresh">
          刷新
        </button>
        <span>已启用项目 {{ enabledProjectCount }}</span>
        <span>展示成员 {{ selectedMembers.length }}</span>
        <span>任务行 {{ tasks.length }}</span>
        <span v-if="resolution.hiddenTaskCount">
          未命中展示成员 {{ resolution.hiddenTaskCount }} 条
        </span>
        <span v-if="unscheduledCount">缺失日期 {{ unscheduledCount }}</span>
        <span v-if="schedule.lastLoadedAt.value">最后刷新 {{ schedule.lastLoadedAt.value }}</span>
      </div>
    </header>

    <p v-if="boardState.message" class="board__state" :class="`board__state--${boardState.kind}`">
      {{ boardState.message }}
      <template v-if="boardState.hint">{{ boardState.hint }}</template>
      <RouterLink v-if="SETTINGS_LINK_STATES.has(boardState.kind)" to="/settings">
        前往设置
      </RouterLink>
    </p>

    <p v-if="errorMessages.length" class="board__error">
      部分项目加载失败（其余项目数据已保留）：{{ errorMessages.join('；') }}
    </p>

    <p v-if="credentials.loadError.value" class="board__error">
      读取凭据失败：{{ credentials.loadError.value }}
    </p>

    <section class="board__canvas">
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

    <footer class="board__selected">
      <template v-if="selectedTask">
        <strong>[{{ selectedTask.projectName }}] {{ selectedTask.title }}</strong>
        <span>负责人：{{ selectedTask.assigneeName || '未分配' }}</span>
        <span>状态：{{ selectedTask.status || '未知' }}</span>
        <span v-if="selectedTask.effort">预估工时：{{ selectedTask.effort }}</span>
        <span>日期：{{ selectedTask.startDate ?? '无' }} ~ {{ selectedTask.dueDate ?? '无' }}</span>
        <a :href="selectedTask.tapdUrl" target="_blank" rel="noreferrer" @click="openTapdLink">
          打开 TAPD
        </a>
      </template>
      <span v-else class="board__muted">
        点击任务条或左侧任务标题可查看要点（悬停任务条显示完整提示）。
      </span>
    </footer>

    <p v-if="externalLinkError" class="board__error">{{ externalLinkError }}</p>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 12px 16px 16px;
}

.board__toolbar {
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

.board__group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.board__group--meta {
  color: var(--ts-color-text-muted);
}

.board__range {
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

button:disabled {
  opacity: 0.6;
  cursor: default;
}

.board__state,
.board__error {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--ts-radius);
}

.board__state {
  border: 1px solid var(--ts-color-border);
  background: var(--ts-color-surface);
  color: var(--ts-color-text-muted);
}

.board__state--loading {
  border-color: #bfdbfe;
  background: #f0f7ff;
}

.board__state--fixture {
  border-color: #f3d19b;
  background: #fff8ec;
  color: var(--ts-color-warning);
}

.board__error {
  border: 1px solid #f3d19b;
  background: #fff8ec;
  color: var(--ts-color-warning);
}

.board__canvas {
  flex: 1 1 auto;
  min-height: 240px;
}

.board__selected {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--ts-color-border);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
}

.board__muted {
  color: var(--ts-color-text-muted);
}
</style>
