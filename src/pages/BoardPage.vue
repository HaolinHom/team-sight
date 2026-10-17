<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import GanttBoard from '@/components/gantt/GanttBoard.vue';
import FilterPanel from '@/components/board/FilterPanel.vue';
import { useCredentials } from '@/composables/useCredentials';
import { useSchedule } from '@/composables/useSchedule';
import { useSettings } from '@/composables/useSettings';
import { useChinaCalendar } from '@/composables/useChinaCalendar';
import { calendarYearsForRanges } from '@/calendar/chinaCalendar';
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
const calendar = useChinaCalendar();
const schedule = useSchedule();
const credentials = useCredentials();

defineOptions({ name: 'BoardPage' });
const active = ref(true);
const ready = ref(false);
const requestedKey = ref('');
const loadedSourceKey = ref('');
let refreshId = 0;

const isDesktop = isTauriRuntime();
const filters = ref<ScheduleFilters>(createDefaultFilters(currentMonthRange()));
const collapsedMemberKeys = ref<string[]>(
  FIXTURE_MODE ? [...GANTT_FIXTURE_COLLAPSED_MEMBERS] : []
);
const selectedTaskKey = ref<string | null>(null);
const externalLinkError = ref('');

const range = computed<DateRange>(() => filters.value.range);
const calendarYears = computed(() => calendarYearsForRanges([range.value]));
const calendarWarnings = computed(() => calendar.warningsFor(calendarYears.value.required));
watch([ready, active, calendar.enabled, calendar.currentYear, () => calendarYears.value.sources.join(',')], () => {
  if (ready.value && active.value && calendar.enabled.value) void calendar.ensure([calendar.currentYear.value, ...calendarYears.value.sources]);
});

/** 数据源：fixture 用固定验收数据，真实模式用阶段1 拉取结果。 */
const dataMatchesRange = computed(() =>
  loadedSourceKey.value === sourceKey.value && credentials.status.value.configured &&
  schedule.loadedRange.value?.start === range.value.start &&
  schedule.loadedRange.value?.end === range.value.end
);
const rawTasks = computed(() =>
  FIXTURE_MODE ? FIXTURE_TASKS : dataMatchesRange.value ? schedule.liveTasks.value : []
);
const sourceKey = computed(() => JSON.stringify({ projects: store.enabledProjects.value.map(p => p.id).sort(), range: range.value, credentialRevision: credentials.credentialRevision.value }));
const projectSource = computed(() => (FIXTURE_MODE ? FIXTURE_PROJECTS : store.enabledProjects.value));
const memberSource = computed<MemberEntry[]>(() =>
  FIXTURE_MODE ? membersFromTasks(FIXTURE_TASKS) : store.settings.value.members
);

const statusOptions = computed(() => collectStatusOptions(rawTasks.value));
const selectedMembers = computed(() =>
  selectMembersByKeys(memberSource.value, filters.value.memberKeys)
);
const filteredTasks = computed(() => filterTasks(rawTasks.value.map(task => {
  const project = projectSource.value.find(item => item.id === task.projectId);
  return project ? { ...task, projectName: project.name, projectColor: project.color } : task;
}), filters.value));
const resolution = computed(() => createMemberResolution(filteredTasks.value, selectedMembers.value));

const tasks = computed(() => filteredTasks.value);
const boardMemberKeysOf = computed(() => resolution.value.memberKeysOf);
const boardMemberNames = computed(() => resolution.value.memberNames);
const boardMemberOrder = computed(() => FIXTURE_MODE ? undefined : [...resolution.value.memberNames.keys()]);

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

const showingPreviousData = computed(() =>
  !FIXTURE_MODE && schedule.lastLoadedAt.value !== null &&
  (schedule.loading.value || schedule.loadStatus.value === 'failed')
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
  const id = ++refreshId;
  const key = sourceKey.value;
  requestedKey.value = key;
  await schedule.refresh(store.enabledProjects.value, filters.value.range);
  if (id === refreshId && schedule.loadStatus.value !== 'failed') loadedSourceKey.value = key;
}
function reconcile(): void {
  if (!ready.value || !active.value) return;
  if (requestedKey.value !== sourceKey.value) {
    selectedTaskKey.value = null;
    if (canAutoLoad.value) void refresh();
  }
}
onMounted(async () => {
  await store.load();
  if (!FIXTURE_MODE) await credentials.refresh();
  ready.value = true;
});
watch([ready, active, sourceKey, canAutoLoad], reconcile);
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; });
onUnmounted(() => { refreshId++; schedule.invalidate(); });

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
        <span v-if="schedule.lastLoadedAt.value">最后成功刷新 {{ schedule.lastLoadedAt.value }}</span>
      </div>
    </header>

    <p v-if="calendarWarnings.length" class="board__state" role="status">{{ calendarWarnings.join('；') }} <RouterLink to="/settings">前往设置查看日历状态</RouterLink></p>

    <p
      v-if="boardState.message && (schedule.loading.value || schedule.loadStatus.value !== 'failed')"
      class="board__state"
      :class="`board__state--${boardState.kind}`"
    >
      {{ boardState.message }}
      <template v-if="boardState.hint">{{ boardState.hint }}</template>
      <RouterLink v-if="SETTINGS_LINK_STATES.has(boardState.kind)" to="/settings">
        前往设置
      </RouterLink>
    </p>

    <p v-if="errorMessages.length" class="board__error">
      {{ schedule.loadStatus.value === 'failed' ? '全部数据源加载失败' : '部分数据源加载失败（本轮成功数据已保留）' }}：{{ errorMessages.join('；') }}
    </p>

    <p v-if="schedule.warnings.value.length" class="board__error">
      数据不完整：{{ schedule.warnings.value.map((item) => `${item.type} @ ${item.workspaceId}：${item.message}`).join('；') }}
    </p>

    <p v-if="showingPreviousData" class="board__state">
      {{ dataMatchesRange ? '当前显示上次成功加载的旧数据' : '上次成功加载的数据与当前时间范围不同，已隐藏旧任务' }}
      （{{ schedule.loadedRange.value?.start }} ~ {{ schedule.loadedRange.value?.end }}）。
    </p>

    <p v-if="credentials.loadError.value" class="board__error">
      读取凭据失败：{{ credentials.loadError.value }}
    </p>

    <section class="board__canvas">
      <GanttBoard
        :tasks="tasks"
        :range="range"
        :calendar="calendar.days.value"
        :collapsed-member-keys="collapsedMemberKeys"
        :selected-task-key="selectedTaskKey"
        :today="today"
        :member-keys-of="boardMemberKeysOf"
        :member-names="boardMemberNames"
        :member-order="boardMemberOrder"
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
