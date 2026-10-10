<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { currentMonthRange, dateDiffInDays, type DateRange } from '@/gantt/dateUtils';
import {
  LARGE_RANGE_DAYS,
  statusKey,
  validateRange,
  type ScheduleFilters,
  type StatusOption,
} from '@/gantt/filters';
import type { ProjectConfig } from '@/types/schedule';
import type { MemberEntry } from '@/types/settings';
import { memberKeyOf } from '@/utils/memberResolution';

const filters = defineModel<ScheduleFilters>({ required: true });

const props = defineProps<{
  projects: ProjectConfig[];
  members: MemberEntry[];
  statusOptions: StatusOption[];
}>();

type GroupId = 'projectIds' | 'memberKeys' | 'statuses';

interface FilterOption {
  key: string;
  label: string;
  hint: string;
  group: string;
}

interface FilterGroup {
  id: GroupId;
  label: string;
  options: FilterOption[];
}

const openGroup = ref<GroupId | ''>('');
const rangeError = ref('');
const rangeNote = ref('');

const groups = computed<FilterGroup[]>(() => [
  {
    id: 'projectIds',
    label: '项目',
    options: props.projects.map((project) => ({
      key: project.id,
      label: project.name,
      hint: project.id,
      group: '',
    })),
  },
  {
    id: 'memberKeys',
    label: '成员',
    options: props.members.map((member) => ({
      key: memberKeyOf(member.staffId),
      label: member.name,
      hint: member.staffId,
      group: '',
    })),
  },
  {
    id: 'statuses',
    label: '状态',
    options: props.statusOptions.map((option) => ({
      key: statusKey(option.sourceType, option.value),
      label: option.value || '未设置',
      hint: `${option.count} 条`,
      group: option.sourceType === 'task' ? '任务' : '缺陷',
    })),
  },
]);

function selectedOf(group: FilterGroup): string[] | null {
  return filters.value[group.id];
}

function allKeysOf(group: FilterGroup): string[] {
  return group.options.map((option) => option.key);
}

function isChecked(group: FilterGroup, key: string): boolean {
  const selected = selectedOf(group);
  return selected === null || selected.includes(key);
}

function badgeOf(group: FilterGroup): string {
  const selected = selectedOf(group);
  if (selected === null) return `全部 ${group.options.length}`;
  return `已选 ${selected.length}/${group.options.length}`;
}

/** 选中数与选项数一致时回到 `null`（全选语义），保证与设置页变更保持一致。 */
function applySelection(group: FilterGroup, next: string[]): void {
  const all = allKeysOf(group);
  const value = all.length > 0 && next.length === all.length ? null : next;
  filters.value = { ...filters.value, [group.id]: value } as ScheduleFilters;
}

function toggleGroup(id: GroupId): void {
  openGroup.value = openGroup.value === id ? '' : id;
}

function toggleOption(group: FilterGroup, key: string, checked: boolean): void {
  const current = selectedOf(group) ?? allKeysOf(group);
  const next = checked ? [...new Set([...current, key])] : current.filter((item) => item !== key);
  applySelection(group, next);
}

function selectAll(group: FilterGroup): void {
  applySelection(group, allKeysOf(group));
}

function clearAll(group: FilterGroup): void {
  applySelection(group, []);
}

function applyRange(range: DateRange): void {
  filters.value = { ...filters.value, range };
  rangeError.value = '';
  rangeNote.value =
    dateDiffInDays(range.start, range.end) > LARGE_RANGE_DAYS ? '时间范围较长，将拉取较多数据' : '';
}

function shiftMonth(offset: number): void {
  const start = new Date(`${filters.value.range.start}T00:00:00Z`);
  applyRange(
    currentMonthRange(new Date(start.getUTCFullYear(), start.getUTCMonth() + offset, 1))
  );
}

function resetMonth(): void {
  applyRange(currentMonthRange());
}

function onRangeInput(which: 'start' | 'end', event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  const start = which === 'start' ? value : filters.value.range.start;
  const end = which === 'end' ? value : filters.value.range.end;

  const result = validateRange(start, end);
  if (result.error || !result.range) {
    rangeError.value = result.error;
    return;
  }
  applyRange(result.range);
  rangeNote.value = result.note;
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.filters')) openGroup.value = '';
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <section class="filters">
    <div class="filters__range">
      <span class="filters__group-label">时间范围</span>
      <input
        class="filters__date"
        type="date"
        :value="filters.range.start"
        aria-label="开始日期"
        @change="onRangeInput('start', $event)"
      />
      <span class="filters__tilde">~</span>
      <input
        class="filters__date"
        type="date"
        :value="filters.range.end"
        aria-label="结束日期"
        @change="onRangeInput('end', $event)"
      />
      <button type="button" @click="shiftMonth(-1)">上一月</button>
      <button type="button" @click="resetMonth">本月</button>
      <button type="button" @click="shiftMonth(1)">下一月</button>
      <span v-if="rangeError" class="filters__error">{{ rangeError }}</span>
      <span v-else-if="rangeNote" class="filters__note">{{ rangeNote }}</span>
    </div>

    <div
      v-for="group in groups"
      :key="group.id"
      class="filters__dropdown"
      :data-group="group.id"
    >
      <button
        type="button"
        class="filters__toggle"
        :aria-expanded="openGroup === group.id"
        @click="toggleGroup(group.id)"
      >
        {{ group.label }}
        <span class="filters__badge">{{ badgeOf(group) }}</span>
      </button>

      <div v-if="openGroup === group.id" class="filters__panel" role="group">
        <div class="filters__panel-actions">
          <button type="button" @click="selectAll(group)">全选</button>
          <button type="button" @click="clearAll(group)">清空</button>
        </div>
        <p v-if="group.options.length === 0" class="filters__empty">暂无可选项</p>
        <label
          v-for="option in group.options"
          :key="option.key"
          class="filters__option"
        >
          <input
            type="checkbox"
            :checked="isChecked(group, option.key)"
            @change="toggleOption(group, option.key, ($event.target as HTMLInputElement).checked)"
          />
          <span v-if="option.group" class="filters__option-group">{{ option.group }}</span>
          <span class="filters__option-label">{{ option.label }}</span>
          <span class="filters__option-hint">{{ option.hint }}</span>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--ts-color-border);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
}

.filters__range {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.filters__group-label,
.filters__tilde {
  color: var(--ts-color-text-muted);
}

.filters__date {
  padding: 3px 6px;
  border: 1px solid var(--ts-color-border-strong);
  border-radius: 4px;
  font-size: 12px;
}

.filters__dropdown {
  position: relative;
}

.filters__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filters__badge {
  color: var(--ts-color-text-muted);
  font-size: 11px;
}

.filters__panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  width: 260px;
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--ts-color-border-strong);
  border-radius: var(--ts-radius);
  background: var(--ts-color-surface);
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.14);
}

.filters__panel-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.filters__empty,
.filters__note,
.filters__error {
  margin: 0;
  font-size: 12px;
}

.filters__note {
  color: var(--ts-color-warning);
}

.filters__error {
  color: #b91c1c;
}

.filters__option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px;
  cursor: pointer;
}

.filters__option-group {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--ts-color-member-bg);
  color: var(--ts-color-text-muted);
  font-size: 11px;
}

.filters__option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filters__option-hint {
  margin-left: auto;
  color: var(--ts-color-text-muted);
  font-size: 11px;
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
</style>
