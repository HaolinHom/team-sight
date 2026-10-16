<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSettings } from '@/composables/useSettings';
import { createHoursSettings, shanghaiToday, validateHoursSettings } from '@/hours/settings';
import type { HoursSettings } from '@/types/hours';

const store = useSettings();
const copy = (value: HoursSettings) => JSON.parse(JSON.stringify(value)) as HoursSettings;
const draft = ref(copy(store.settings.value.hours ?? createHoursSettings()));
const busy = ref(false);
const message = ref('');
const validationError = ref('');
watch(() => store.settings.value.hours, value => { draft.value = copy(value ?? createHoursSettings()); });
async function save(): Promise<void> {
  validationError.value = validateHoursSettings(draft.value);
  message.value = '';
  if (validationError.value) return;
  busy.value = true;
  const ok = await store.updateHours(draft.value);
  if (ok) message.value = '工时统计配置已保存';
  else draft.value = copy(store.settings.value.hours ?? createHoursSettings());
  busy.value = false;
}
function setStates(index: number, event: Event): void {
  draft.value.completedStates[index].values = (event.target as HTMLInputElement).value.split(/[,，;；\n]/).map(value => value.trim()).filter(Boolean);
}
</script>

<template>
  <section class="hours-settings" aria-labelledby="hours-settings-title">
    <h2 id="hours-settings-title">工时统计</h2>
    <p>默认周一至周五为工作日，统计日界为北京时间。当前规定工时：{{ store.settings.value.hours?.dailyRequiredHours ?? 8 }} 小时。</p>
    <fieldset :disabled="busy">
      <label class="required-hours">每日规定工时
        <input v-model.number="draft.dailyRequiredHours" type="number" min="0" step="any" aria-label="每日规定工时" /> 小时
      </label>
      <h3>节假日／调休</h3>
      <p>仅覆盖指定日期；截止在休息日的任务可将工作日余量分配到末尾休息日，不受每日规定工时限制；已有实际填报仍可查看。</p>
      <div v-for="(item, index) in draft.calendarOverrides" :key="index" class="config-row">
        <input v-model="item.date" type="date" aria-label="日历覆盖日期" />
        <select v-model="item.working" aria-label="日期类型"><option :value="false">休息日</option><option :value="true">工作日</option></select>
        <input v-model="item.note" placeholder="说明（可选）" aria-label="日历覆盖说明" />
        <button type="button" @click="draft.calendarOverrides.splice(index, 1)">移除</button>
      </div>
      <button type="button" @click="draft.calendarOverrides.push({ date: shanghaiToday(), working: false, note: '' })">添加日期覆盖</button>
      <h3>成员整日请假豁免</h3>
      <div v-for="(item, index) in draft.exemptions" :key="index" class="config-row">
        <select v-model="item.staffId" aria-label="豁免成员"><option value="">选择成员</option><option v-for="member in store.settings.value.members" :key="member.staffId" :value="member.staffId">{{ member.name }}</option></select>
        <input v-model="item.date" type="date" aria-label="豁免日期" />
        <input v-model="item.note" placeholder="请假说明（可选）" aria-label="豁免说明" />
        <button type="button" @click="draft.exemptions.splice(index, 1)">移除</button>
      </div>
      <button type="button" :disabled="!store.settings.value.members.length" @click="draft.exemptions.push({ staffId: store.settings.value.members[0]?.staffId ?? '', date: shanghaiToday(), note: '' })">添加成员豁免</button>
      <h3>补充结束状态</h3>
      <p>done、closed、resolved、rejected 默认视为结束。自定义状态请填写 TAPD 状态原值，以逗号分隔。</p>
      <div v-for="(item, index) in draft.completedStates" :key="index" class="config-row">
        <select v-model="item.projectId" aria-label="结束状态项目"><option v-for="project in store.settings.value.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select>
        <select v-model="item.type" aria-label="结束状态类型"><option value="task">任务</option><option value="bug">缺陷</option></select>
        <input :value="item.values.join(', ')" placeholder="例如：已验收, 已取消" aria-label="结束状态原值" @input="setStates(index, $event)" />
        <button type="button" @click="draft.completedStates.splice(index, 1)">移除</button>
      </div>
      <button type="button" :disabled="!store.settings.value.projects.length" @click="draft.completedStates.push({ projectId: store.settings.value.projects[0]?.id ?? '', type: 'task', values: [] })">添加结束状态</button>
      <div class="save-row"><button type="button" @click="save">{{ busy ? '保存中…' : '保存工时配置' }}</button><span v-if="message" role="status">{{ message }}</span></div>
    </fieldset>
    <p v-if="validationError" role="alert">{{ validationError }}</p>
  </section>
</template>

<style scoped>
.hours-settings { padding: 12px 14px; border: 1px solid var(--ts-color-border); border-radius: var(--ts-radius); background: var(--ts-color-surface); }
h2 { margin: 0 0 8px; font-size: 14px; }
h3 { margin: 18px 0 8px; font-size: 13px; }
p { color: var(--ts-color-text-muted); margin: 6px 0 10px; font-size: 12px; }
fieldset { border: 0; margin: 0; padding: 0; }
.required-hours, .config-row, .save-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.config-row { margin-bottom: 8px; }
.required-hours input { width: 90px; }
input, select, button { border: 1px solid var(--ts-color-border-strong); border-radius: 4px; padding: 5px 8px; background: var(--ts-color-surface); color: var(--ts-color-text); font-size: 12px; }
button { cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
.save-row { margin-top: 18px; }
.save-row button { background: #1d4ed8; color: white; }
[role="alert"] { color: #b91c1c; }
</style>
