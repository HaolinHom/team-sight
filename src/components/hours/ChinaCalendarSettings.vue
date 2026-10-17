<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSettings } from '@/composables/useSettings';
import { useChinaCalendar } from '@/composables/useChinaCalendar';

const store = useSettings(), calendar = useChinaCalendar();
const saving = ref(false);
watch([calendar.enabled, calendar.currentYear], ([enabled, year]) => {
  if (enabled) void calendar.ensure([year]);
}, { immediate: true });
async function toggle(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  input.checked = calendar.enabled.value;
  saving.value = true;
  try { await store.setChinaCalendarEnabled(enabled); }
  finally { input.checked = calendar.enabled.value; saving.value = false; }
}
function fetchedAt(year: number): string {
  const cache = store.settings.value.chinaCalendar.years[year];
  return cache ? new Date(cache.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
}
</script>

<template>
  <section class="china-calendar" aria-labelledby="china-calendar-title">
    <h3 id="china-calendar-title">中国节假日及调休</h3>
    <label><input type="checkbox" :checked="calendar.enabled.value" :disabled="saving" @change="toggle" /> 启用中国节假日及调休</label>
    <p>用于看板和工时统计。来源：NateScarlet/holiday-cn（按国务院公告整理）。成功获取后永久缓存，点击年份状态可重新获取。</p>
    <ul aria-label="各年份节假日缓存状态">
      <li v-for="year in calendar.years.value" :key="year">
        <span>{{ year }} 年</span>
        <button type="button" class="calendar-status" :class="store.settings.value.chinaCalendar.years[year] ? 'is-cached' : 'is-missing'" :disabled="calendar.loading.value[year]" :aria-busy="!!calendar.loading.value[year]" :aria-label="`${year} 年${store.settings.value.chinaCalendar.years[year] ? '已缓存' : '未获取'}，点击刷新`" @click="calendar.refresh(year)">
          {{ calendar.loading.value[year] ? '获取中…' : store.settings.value.chinaCalendar.years[year] ? '已缓存' : '未获取' }}
        </button>
        <span v-if="fetchedAt(year)" class="cached-time">获取时间：{{ fetchedAt(year) }}（北京时间）</span>
        <p v-if="calendar.errors.value[year]" role="alert">{{ calendar.errors.value[year] }}{{ store.settings.value.chinaCalendar.years[year] ? '；继续使用已缓存数据。' : '；点击状态重试。' }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.china-calendar { margin: 16px 0; }
h3 { margin: 0 0 8px; font-size: 13px; }
label, li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
p, .cached-time { color: var(--ts-color-text-muted); font-size: 12px; }
ul { list-style: none; padding: 0; margin: 8px 0; }
li { margin: 8px 0; }
.calendar-status { padding: 3px 10px; border: 1px solid; border-radius: 12px; cursor: pointer; font-size: 12px; }
.is-cached { color: #166534; border-color: #86efac; background: #f0fdf4; }
.is-missing { color: #991b1b; border-color: #fca5a5; background: #fef2f2; }
.calendar-status:disabled { cursor: wait; }
.calendar-status:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
li p { flex-basis: 100%; margin: 0; color: #b91c1c; }
</style>
