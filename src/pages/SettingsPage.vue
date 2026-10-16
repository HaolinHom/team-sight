<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { useCredentials } from '@/composables/useCredentials';
import { useSettings } from '@/composables/useSettings';
import { fetchWorkspaceUsers } from '@/services/tapd/client';
import { fetchUserProjects, isScheduleProject, type TapdProjectSummary } from '@/services/tapd/projects';
import { PROJECT_PALETTE, type MemberEntry } from '@/types/settings';
import type { ProjectConfig } from '@/types/schedule';
import HoursSettingsCard from '@/components/hours/HoursSettingsCard.vue';

const credentials = useCredentials();
const store = useSettings();

const tokenInput = ref('');
const availableProjects = ref<TapdProjectSummary[]>([]);
const projectsBusy = ref(false);
const projectsMessage = ref('');
const memberDirectory = ref<MemberEntry[]>([]);
const membersBusy = ref(false);
const membersMessage = ref('');
const memberKeyword = ref('');
const sortingMembers = ref(false);
const memberDropTarget = ref<{ staffId: string; placement: 'before' | 'after' } | null>(null);
let memberDrag: { staffId: string; pointerId: number; x: number; y: number; moved: boolean; handle: HTMLElement } | null = null;

const configuredProjectIds = computed(
  () => new Set(store.settings.value.projects.map((project) => project.id))
);

const selectableProjects = computed(() =>
  availableProjects.value.filter(isScheduleProject).filter((project) => project.id)
);

const memberResults = computed(() => {
  const keyword = memberKeyword.value.trim().toLowerCase();
  const added = new Set(store.settings.value.members.map((member) => member.staffId));
  return memberDirectory.value
    .filter((member) => !added.has(member.staffId))
    .filter((member) => {
      if (!keyword) return true;
      return (
        member.name.toLowerCase().includes(keyword) ||
        member.staffId.toLowerCase().includes(keyword)
      );
    })
    .slice(0, 30);
});

const enabledProjectCount = computed(() => store.enabledProjects.value.length);

const sourceLabel = computed(() => {
  switch (credentials.status.value.source) {
    case 'file':
      return '应用配置目录（本地文件，0600）';
    case 'env':
      return '环境变量 / .env.local（开发期）';
    case 'browser':
      return '浏览器 localStorage（仅开发模式）';
    default:
      return '未配置';
  }
});

onMounted(async () => {
  await store.load(true);
  await credentials.refresh();
});

async function saveToken(): Promise<void> {
  const ok = await credentials.save(tokenInput.value);
  if (ok) tokenInput.value = '';
}

async function loadProjects(): Promise<void> {
  projectsBusy.value = true;
  projectsMessage.value = '正在读取项目列表…';
  try {
    const projects = await fetchUserProjects();
    availableProjects.value = projects;
    projectsMessage.value = `读取到 ${projects.length} 个项目（其中 ${projects.filter(isScheduleProject).length} 个为项目类型）`;
  } catch (error) {
    projectsMessage.value = `读取失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    projectsBusy.value = false;
  }
}

async function addProject(project: TapdProjectSummary): Promise<void> {
  await store.addProject({ id: project.id, name: project.name });
}

function updateProjectEnabled(project: ProjectConfig, event: Event): void {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  input.checked = project.enabled;
  void store.updateProject(project.id, { enabled });
}

function updateProjectColor(project: ProjectConfig, event: Event): void {
  const input = event.target as HTMLInputElement;
  const color = input.value;
  input.value = project.color;
  void store.updateProject(project.id, { color });
}

async function loadMemberCandidates(): Promise<void> {
  const projects = store.enabledProjects.value;
  if (projects.length === 0) {
    membersMessage.value = '请先启用至少一个项目，再加载成员候选';
    return;
  }

  membersBusy.value = true;
  membersMessage.value = '正在读取成员目录…';
  const directory = new Map<string, MemberEntry>();
  const failures: string[] = [];
  try {
    for (const project of projects) {
      try {
        const members = await fetchWorkspaceUsers(project.id);
        for (const [staffId, name] of Object.entries(members)) {
          if (!directory.has(staffId)) directory.set(staffId, { staffId, name });
        }
      } catch (error) {
        failures.push(
          `${project.name}：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    memberDirectory.value = [...directory.values()];
    membersMessage.value = failures.length
      ? `已加载 ${memberDirectory.value.length} 人；部分项目失败：${failures.join('；')}`
      : `已加载 ${memberDirectory.value.length} 人（来自 ${projects.length} 个已启用项目）`;
  } finally {
    membersBusy.value = false;
  }
}

async function addMember(member: MemberEntry): Promise<void> {
  await store.addMembers([member]);
}

async function moveMember(staffId: string, targetStaffId: string, placement: 'before' | 'after'): Promise<void> {
  if (sortingMembers.value) return;
  sortingMembers.value = true;
  try {
    await store.moveMember(staffId, targetStaffId, placement);
  } finally {
    sortingMembers.value = false;
  }
}

function startMemberDrag(staffId: string, event: PointerEvent): void {
  if (sortingMembers.value || memberDrag || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus({ preventScroll: true });
  memberDrag = { staffId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, handle };
  handle.setPointerCapture(event.pointerId);
}

function memberTargetAt(event: PointerEvent): typeof memberDropTarget.value {
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.member-order__item');
  if (!row || row.closest('.member-order') !== memberDrag?.handle.closest('.member-order')) return null;
  const staffId = row.dataset.memberId;
  if (!staffId || staffId === memberDrag?.staffId) return null;
  const bounds = row.getBoundingClientRect();
  return { staffId, placement: event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before' };
}

function overMember(event: PointerEvent): void {
  if (!memberDrag || memberDrag.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - memberDrag.x, event.clientY - memberDrag.y) >= 4) memberDrag.moved = true;
  memberDropTarget.value = memberDrag.moved ? memberTargetAt(event) : null;
}

function endMemberDrag(): void {
  const drag = memberDrag;
  memberDrag = null;
  memberDropTarget.value = null;
  if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
}

function dropMember(event: PointerEvent): void {
  if (!memberDrag || memberDrag.pointerId !== event.pointerId) return;
  const source = memberDrag.staffId;
  const target = memberDrag.moved ? memberTargetAt(event) : null;
  endMemberDrag();
  if (target) void moveMember(source, target.staffId, target.placement);
}

onUnmounted(endMemberDrag);
</script>

<template>
  <div class="settings" @keydown.esc="endMemberDrag">
    <h1 class="settings__title">设置</h1>

    <section class="card">
      <header class="card__header">
        <h2>TAPD 令牌</h2>
        <span class="card__meta">
          状态：{{ credentials.status.value.configured ? '已配置' : '未配置' }}｜来源：{{ sourceLabel }}
          <template v-if="credentials.status.value.maskedHint">
            ｜{{ credentials.status.value.maskedHint }}
          </template>
        </span>
      </header>

      <p class="notice">
        当前版本把令牌保存在本机应用配置目录的本地文件中（明文、权限 0600），后续会替换为系统钥匙串。
        <template v-if="credentials.isBrowserMode">
          浏览器模式仅用于开发调试，且无法直连 TAPD，真实数据请在桌面端加载。
        </template>
      </p>

      <div class="row">
        <input
          v-model="tokenInput"
          class="row__input"
          type="password"
          placeholder="粘贴 TAPD personal token"
          aria-label="TAPD 令牌"
        />
        <button type="button" :disabled="credentials.busy.value || !tokenInput.trim()" @click="saveToken">
          保存
        </button>
        <button type="button" :disabled="credentials.busy.value" @click="credentials.test">
          测试连接
        </button>
        <button type="button" :disabled="credentials.busy.value" @click="credentials.clear">
          清除
        </button>
      </div>
      <p v-if="credentials.message.value" class="message">{{ credentials.message.value }}</p>
    </section>

    <section class="card">
      <header class="card__header">
        <h2>项目</h2>
        <span class="card__meta">已配置 {{ store.settings.value.projects.length }} 个，启用 {{ enabledProjectCount }} 个</span>
      </header>

      <div class="row">
        <button type="button" :disabled="projectsBusy" @click="loadProjects">
          读取我的 TAPD 项目
        </button>
        <span v-if="projectsMessage" class="message">{{ projectsMessage }}</span>
      </div>

      <table v-if="store.settings.value.projects.length" class="table">
        <thead>
          <tr>
            <th>启用</th>
            <th>项目</th>
            <th>ID</th>
            <th>颜色</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in store.settings.value.projects" :key="project.id">
            <td>
              <input
                type="checkbox"
                :checked="project.enabled"
                :aria-label="`启用 ${project.name}`"
                @change="updateProjectEnabled(project, $event)"
              />
            </td>
            <td>{{ project.name }}</td>
            <td class="mono">{{ project.id }}</td>
            <td>
              <input
                type="color"
                :value="project.color"
                :aria-label="`${project.name} 的颜色`"
                @change="updateProjectColor(project, $event)"
              />
            </td>
            <td>
              <button type="button" class="link" @click="store.removeProject(project.id)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="message">尚未配置项目。点击上方按钮读取 TAPD 项目后添加。</p>

      <div v-if="selectableProjects.length" class="candidates">
        <p class="card__meta">可选择（未添加的 project 类型项目）：</p>
        <ul class="candidates__list">
          <li v-for="project in selectableProjects" :key="project.id">
            <span>{{ project.name }}</span>
            <span class="mono">{{ project.id }}</span>
            <button
              type="button"
              :disabled="configuredProjectIds.has(project.id)"
              @click="addProject(project)"
            >
              {{ configuredProjectIds.has(project.id) ? '已添加' : '添加' }}
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section class="card">
      <header class="card__header">
        <h2>展示成员</h2>
        <span class="card__meta">已配置 {{ store.settings.value.members.length }} 人</span>
      </header>

      <p class="notice">
        看板仅展示已配置成员的任务；同一任务有多个已配置负责人时，会在每个成员分组下各占一行。
        成员候选来自「已启用项目」的成员目录。
        拖动手柄或使用前移／后移按钮调整顺序，自动保存后同步到看板与工时页面。
      </p>

      <div class="row">
        <button type="button" :disabled="membersBusy" @click="loadMemberCandidates">
          加载成员候选
        </button>
        <input
          v-model="memberKeyword"
          class="row__input"
          type="search"
          placeholder="按姓名或工号搜索"
          aria-label="搜索成员"
        />
        <span v-if="membersMessage" class="message">{{ membersMessage }}</span>
      </div>

      <ul v-if="memberResults.length" class="candidates__list">
        <li v-for="member in memberResults" :key="member.staffId">
          <span>{{ member.name }}</span>
          <span class="mono">{{ member.staffId }}</span>
          <button type="button" @click="addMember(member)">添加</button>
        </li>
      </ul>

      <ol v-if="store.settings.value.members.length" class="member-order" aria-label="展示成员顺序">
        <li
          v-for="(member, index) in store.settings.value.members"
          :key="member.staffId"
          :data-member-id="member.staffId"
          class="member-order__item"
          :class="{
            'member-order__item--before': memberDropTarget?.staffId === member.staffId && memberDropTarget.placement === 'before',
            'member-order__item--after': memberDropTarget?.staffId === member.staffId && memberDropTarget.placement === 'after',
          }"
        >
          <span class="member-order__number">{{ index + 1 }}</span>
          <button
            type="button"
            class="member-order__handle"
            :disabled="sortingMembers"
            :aria-label="`拖动 ${member.name}`"
            @pointerdown="startMemberDrag(member.staffId, $event)"
            @pointermove="overMember"
            @pointerup="dropMember"
            @pointercancel="endMemberDrag"
            @lostpointercapture="endMemberDrag"
            @dragstart.prevent
          >⠿</button>
          <span class="member-order__name">{{ member.name }} <span class="mono">{{ member.staffId }}</span></span>
          <button type="button" :disabled="sortingMembers || index === 0" :aria-label="`前移 ${member.name}`" @click="moveMember(member.staffId, store.settings.value.members[index - 1].staffId, 'before')">前移</button>
          <button type="button" :disabled="sortingMembers || index === store.settings.value.members.length - 1" :aria-label="`后移 ${member.name}`" @click="moveMember(member.staffId, store.settings.value.members[index + 1].staffId, 'after')">后移</button>
          <button type="button" class="link" @click="store.removeMember(member.staffId)">移除</button>
        </li>
      </ol>
      <p v-else class="message">尚未配置成员，看板将不显示任何任务。</p>
    </section>

    <HoursSettingsCard />

    <p v-if="store.saveError.value" class="message" role="alert">{{ store.saveError.value }}</p>
    <p v-if="store.warning.value" class="message">{{ store.warning.value }}</p>
    <p class="card__meta">
      调色板：<span v-for="color in PROJECT_PALETTE" :key="color" class="swatch" :style="{ background: color }" />
    </p>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow: auto;
  padding: 16px;
}

.settings__title {
  margin: 0;
  font-size: 16px;
}

.card {
  padding: 12px 14px;
  border: 1px solid var(--ts-color-border);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
}

.card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.card__header h2 {
  margin: 0;
  font-size: 14px;
}

.card__meta {
  color: var(--ts-color-text-muted);
  font-size: 12px;
}

.notice {
  margin: 0 0 8px;
  color: var(--ts-color-text-muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.row__input {
  width: 320px;
  padding: 4px 8px;
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

button:disabled {
  opacity: 0.6;
  cursor: default;
}

button.link {
  border: none;
  background: transparent;
  color: #1d4ed8;
}

.message {
  margin: 4px 0 0;
  color: var(--ts-color-text-muted);
  font-size: 12px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}

.table th,
.table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--ts-color-border);
  text-align: left;
}

.candidates {
  margin-top: 8px;
}

.candidates__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.candidates__list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--ts-color-border);
  border-radius: 12px;
  background: var(--ts-color-bg);
}

.member-order {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 720px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.member-order__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--ts-color-border);
  border-radius: 4px;
  background: var(--ts-color-bg);
}

.member-order__item--before { box-shadow: inset 0 2px #3b82f6; }
.member-order__item--after { box-shadow: inset 0 -2px #3b82f6; }
.member-order__number { min-width: 24px; color: var(--ts-color-text-muted); }
.member-order__name { flex: 1; }
.member-order__name .mono { margin-left: 6px; color: var(--ts-color-text-muted); }
.member-order__handle { cursor: grab; user-select: none; touch-action: none; -webkit-user-drag: none; }
.member-order__handle:active { cursor: grabbing; }

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 4px;
  border-radius: 3px;
  vertical-align: middle;
}
</style>
