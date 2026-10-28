<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { LeaveExemption } from '@/types/hours';
import type { MemberEntry } from '@/types/settings';
import { addDays, eachDateKey, isValidDateKey } from '@/gantt/dateUtils';
import { createHoursSettings, shanghaiToday, validateHoursSettings } from '@/hours/settings';

const props = defineProps<{ modelValue: LeaveExemption[]; members: readonly MemberEntry[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: LeaveExemption[]] }>();
const today = shanghaiToday();
const month = ref(today.slice(0, 7));
const selectedDate = ref('');
const rows = ref<LeaveExemption[]>([]);
const error = ref('');
const dialog = ref<HTMLDialogElement | null>(null);
let returnFocus: HTMLElement | null = null;
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const memberName = (staffId: string) => props.members.find(member => member.staffId === staffId)?.name ?? staffId;
const byDate = computed(() => {
  const order = new Map(props.members.map((member, index) => [member.staffId, index]));
  const result = new Map<string, LeaveExemption[]>();
  for (const item of props.modelValue) {
    const entries = result.get(item.date) ?? [];
    entries.push(item);
    result.set(item.date, entries);
  }
  for (const entries of result.values()) entries.sort((a, b) => (order.get(a.staffId) ?? Infinity) - (order.get(b.staffId) ?? Infinity));
  return result;
});
const weeks = computed(() => {
  const first = month.value + '-01';
  const date = new Date(first + 'T00:00:00Z');
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: (date.getUTCDay() + 6) % 7 }, () => null);
  cells.push(...eachDateKey({ start: first, end: month.value + '-' + String(last).padStart(2, '0') }));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
});
const canAdd = computed(() => props.members.some(member => !rows.value.some(row => row.staffId === member.staffId)));
function changeMonth(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (isValidDateKey(input.value + '-01')) month.value = input.value;
  input.value = month.value;
}
function moveMonth(direction: number): void {
  const first = month.value + '-01';
  month.value = direction < 0 ? addDays(first, -1).slice(0, 7) : addDays(first, 32).slice(0, 7);
}
async function edit(date: string, event: MouseEvent): Promise<void> {
  if (props.disabled) return;
  returnFocus = event.currentTarget as HTMLElement;
  selectedDate.value = date;
  rows.value = (byDate.value.get(date) ?? []).map(item => ({ ...item }));
  error.value = '';
  await nextTick();
  dialog.value?.showModal();
  dialog.value?.querySelector<HTMLButtonElement>('[aria-label="关闭请假编辑"]')?.focus();
}
function addMember(): void {
  const member = props.members.find(member => !rows.value.some(row => row.staffId === member.staffId));
  if (member) rows.value.push({ staffId: member.staffId, date: selectedDate.value, hours: 8, note: '' });
}
function close(): void {
  dialog.value?.close();
  selectedDate.value = '';
  returnFocus?.focus();
}
function confirm(): void {
  error.value = validateHoursSettings({ ...createHoursSettings(), exemptions: rows.value });
  if (error.value || props.disabled) return;
  emit('update:modelValue', [...props.modelValue.filter(item => item.date !== selectedDate.value), ...rows.value.map(item => ({ ...item }))]);
  close();
}
function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const controls = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
  if (!controls?.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
</script>

<template>
  <section class="leave-calendar" aria-labelledby="leave-calendar-title">
    <h3 id="leave-calendar-title">成员请假配置</h3>
    <p>点击日期配置成员及请假工时。确认后请点击“保存工时配置”生效。</p>
    <p v-if="!members.length" class="empty-members">请先添加展示成员，再配置请假。</p>
    <div class="calendar-toolbar">
      <button type="button" aria-label="上个月" :disabled="disabled || month === '0100-01'" @click="moveMonth(-1)">‹</button>
      <input type="month" :value="month" min="0100-01" max="9999-12" aria-label="请假日历月份" :disabled="disabled" @change="changeMonth" />
      <button type="button" aria-label="下个月" :disabled="disabled || month === '9999-12'" @click="moveMonth(1)">›</button>
      <button type="button" :disabled="disabled" @click="month = today.slice(0, 7)">返回本月</button>
    </div>
    <div class="calendar-scroll">
      <table :aria-label="month + ' 成员请假日历'">
        <thead><tr><th v-for="weekday in weekdays" :key="weekday" scope="col">周{{ weekday }}</th></tr></thead>
        <tbody>
          <tr v-for="(week, index) in weeks" :key="index">
            <td v-for="(date, column) in week" :key="date ?? column" :class="{ weekend: column > 4 }">
              <button v-if="date" type="button" class="calendar-day" :class="{ today: date === today }" :data-date="date" :aria-label="'配置 ' + date + ' 请假'" :aria-current="date === today ? 'date' : undefined" :disabled="disabled || !members.length" @click="edit(date, $event)">
                <span class="date-label">{{ Number(date.slice(-2)) }}<span v-if="date === today">今天</span></span>
                <span class="leave-list">
                  <span v-for="item in byDate.get(date) ?? []" :key="item.staffId" class="leave-entry" :title="memberName(item.staffId) + '（' + item.staffId + '）' + (item.note ? '：' + item.note : '')">{{ memberName(item.staffId) }} · {{ item.hours }}h</span>
                </span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <dialog v-if="selectedDate" ref="dialog" aria-labelledby="leave-editor-title" aria-modal="true" @cancel.prevent="close" @keydown="trapFocus">
      <form @submit.prevent="confirm">
        <header><h3 id="leave-editor-title">{{ selectedDate }} · 成员请假</h3><button type="button" aria-label="关闭请假编辑" @click="close">×</button></header>
        <p>每名成员单独设置工时，默认 8h；请假工时会扣减当日工作目标。</p>
        <fieldset :disabled="disabled">
          <p v-if="!rows.length">当天尚未配置请假。</p>
          <div v-for="(row, index) in rows" :key="index" class="leave-row">
            <label>成员
              <select v-model="row.staffId" :aria-label="'请假成员 ' + (index + 1)">
                <option v-if="!members.some(member => member.staffId === row.staffId)" :value="row.staffId">{{ row.staffId }}（已移除）</option>
                <option v-for="member in members" :key="member.staffId" :value="member.staffId" :disabled="rows.some((other, otherIndex) => otherIndex !== index && other.staffId === member.staffId)">{{ member.name }}（{{ member.staffId }}）</option>
              </select>
            </label>
            <label>请假工时（h）<input v-model.number="row.hours" type="number" step="any" :aria-label="'请假工时 ' + (index + 1)" /></label>
            <label class="note">说明（可选）<input v-model="row.note" :aria-label="'请假说明 ' + (index + 1)" /></label>
            <button type="button" :aria-label="'移除请假成员 ' + (index + 1)" @click="rows.splice(index, 1)">移除</button>
          </div>
          <button type="button" :disabled="!canAdd" @click="addMember">添加成员</button>
          <p v-if="error" role="alert">{{ error }}</p>
          <footer><button type="button" @click="close">取消</button><button type="submit" class="primary">确定</button></footer>
        </fieldset>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
h3 { margin: 0 0 8px; font-size: 13px; }
p { margin: 6px 0 10px; color: var(--ts-color-text-muted); font-size: 12px; }
.calendar-toolbar, header, footer { display: flex; align-items: center; gap: 8px; }
.calendar-toolbar { margin-bottom: 10px; }
.calendar-scroll { overflow-x: auto; }
table { width: 100%; min-width: 560px; table-layout: fixed; border-collapse: collapse; }
th { padding: 8px; color: var(--ts-color-text-muted); font-weight: 500; }
td { padding: 0; border: 1px solid var(--ts-color-border); vertical-align: top; }
td.weekend { background: var(--ts-color-weekend); }
button, input, select { border: 1px solid var(--ts-color-border-strong); border-radius: 4px; padding: 5px 8px; background: var(--ts-color-surface); color: var(--ts-color-text); font: inherit; font-size: 12px; }
button { cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.calendar-day { display: flex; flex-direction: column; gap: 6px; width: 100%; height: 108px; padding: 8px; border: 0; border-radius: 0; text-align: left; background: transparent; }
.calendar-day:hover:not(:disabled) { background: #eff6ff; }
.calendar-day.today { box-shadow: inset 0 0 0 2px #2563eb; }
.date-label { display: flex; justify-content: space-between; gap: 4px; font-weight: 600; }
.date-label > span { color: #1d4ed8; font-size: 11px; }
.leave-list { display: block; width: 100%; overflow-y: auto; min-height: 0; }
.leave-entry { display: block; margin-bottom: 4px; padding: 3px 5px; border-radius: 3px; background: #eef2ff; color: #3730a3; overflow-wrap: anywhere; }
dialog { width: min(800px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 20px; border: 1px solid var(--ts-color-border); border-radius: 8px; color: var(--ts-color-text); background: var(--ts-color-surface); box-shadow: 0 12px 48px #0003; }
dialog::backdrop { background: #11182766; }
header { justify-content: space-between; }
header h3 { margin: 0; font-size: 15px; }
fieldset { border: 0; padding: 0; margin: 0; }
.leave-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; padding: 12px 0; border-bottom: 1px solid var(--ts-color-border); margin-bottom: 12px; }
label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
label input[type="number"] { width: 110px; }
.note { flex: 1; min-width: 160px; }
footer { justify-content: flex-end; margin-top: 20px; }
.primary { background: #1d4ed8; color: white; border-color: #1d4ed8; }
[role="alert"] { color: #b91c1c; }
</style>
