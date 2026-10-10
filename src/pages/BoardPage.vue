<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import GanttBoard from '@/components/gantt/GanttBoard.vue';
import { useCredentials } from '@/composables/useCredentials';
import { useSchedule } from '@/composables/useSchedule';
import { useSettings } from '@/composables/useSettings';
import { GANTT_FIXTURE_COLLAPSED_MEMBERS, GANTT_FIXTURE_TASKS } from '@/fixtures/ganttFixture';
import { resolveBoardState } from '@/gantt/boardState';
import { currentMonthRange, todayKey, type DateRange } from '@/gantt/dateUtils';
import { describeTapdError } from '@/services/credentials';
import { openExternalUrl } from '@/services/externalLink';
import { isTauriRuntime } from '@/services/tapd/client';

/** 视觉验收模式：使用固定数据，不请求 TAPD，也不要求凭据与配置。 */
const FIXTURE_MODE = import.meta.env.VITE_BOARD_FIXTURE === '1';
const SETTINGS_LINK_STATES = new Set(['no-credential', 'no-projects', 'no-members']);

const store = useSettings();
const schedule = useSchedule();
const credentials = useCredentials();

const isDesktop = isTauriRuntime();
const range = ref<DateRange>(currentMonthRange());
const collapsedMemberKeys = ref<string[]>(
  FIXTURE_MODE ? [...GANTT_FIXTURE_COLLAPSED_MEMBERS] : []
);
const selectedTaskKey = ref<string | null>(null);
const externalLinkError = ref('');

const tasks = computed(() => (FIXTURE_MODE ? GANTT_FIXTURE_TASKS : schedule.liveTasks.value));
const boardMemberKeysOf = computed(() => (FIXTURE_MODE ? undefined : schedule.memberKeysOf));
const boardMemberNames = computed<Map<string, string> | undefined>(() =>
  FIXTURE_MODE ? undefined : schedule.memberNames.value
);

const enabledProjectCount = computed(() => store.enabledProjects.value.length);
const memberCount = computed(() => store.settings.value.members.length);

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
    memberCount: memberCount.value,
    taskCount: tasks.value.length,
  })
);

const selectedTask = computed(() =>
  tasks.value.find((task) => `${task.sourceType}:${task.id}` === selectedTaskKey.value)
);

const unscheduledCount = computed(
  () => tasks.value.filter((task) => !task.startDate || !task.dueDate).length
);

const errorMessages = computed(() =>
  schedule.errors.value.map(
    (error) =>
      `${error.type} @ ${error.workspaceId}：${describeTapdError(error.status, error.message, error.workspaceId)}`
  )
);

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
  await schedule.refresh(store.enabledProjects.value, range.value);
}

onMounted(async () => {
  await store.load();
  if (!FIXTURE_MODE) await credentials.refresh();
  await refresh();
});

// 切换月份后按新时间窗重新拉取（fixture 模式只重算布局）。
watch(range, () => {
  void refresh();
});

const today = todayKey();
</script>

<template>
  <div class="board">
    <header class="board__toolbar">
      <div class="board__group">
        <button type="button" @click="shiftMonth(-1)">上一月</button>
        <button type="button" @click="resetMonth">本月</button>
        <button type="button" @click="shiftMonth(1)">下一月</button>
        <span class="board__range">{{ range.start }} ~ {{ range.end }}</span>
      </div>
      <div class="board__group board__group--meta">
        <button type="button" :disabled="!canAutoLoad || schedule.loading.value" @click="refresh">
          刷新
        </button>
        <span>已启用项目 {{ enabledProjectCount }}</span>
        <span>展示成员 {{ memberCount }}</span>
        <span>任务行 {{ tasks.length }}</span>
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
        <span>日期：{{ selectedTask.startDate ?? '无' }} ~ {{ selectedTask.dueDate ?? '无' }}</span>
        <a :href="selectedTask.tapdUrl" target="_blank" rel="noreferrer" @click="openTapdLink">
          打开 TAPD
        </a>
      </template>
      <span v-else class="board__muted">
        点击任务条或左侧任务标题可查看要点；完整任务详情在阶段3 实现。
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
