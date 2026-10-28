<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { currentMonthRange, eachDateKey, type DateRange } from '@/gantt/dateUtils';
import { validateRange } from '@/gantt/filters';
import { useHours, hoursQueryKey } from '@/composables/useHours';
import { useSettings } from '@/composables/useSettings';
import { useChinaCalendar } from '@/composables/useChinaCalendar';
import { calendarYearsForRanges, calendarTaskRanges, isWorkingDay } from '@/calendar/chinaCalendar';
import { useCredentials } from '@/composables/useCredentials';
import { createHoursSettings, shanghaiToday, isHoursCompleted } from '@/hours/settings';
import { formatHours, hoursTaskKey } from '@/hours/statistics';
import { isTauriRuntime } from '@/services/tapd/client';
import { openExternalUrl } from '@/services/externalLink';
import { buildTapdUrl } from '@/services/tapd/mapper';
import { createHoursFixture } from '@/fixtures/hoursFixture';
import { matrixWindow, MATRIX_COLUMN_WIDTH, MATRIX_ROW_HEIGHT } from '@/hours/matrixWindow';
import { createHoursCalculator } from '@/hours/workerClient';
import type { DailyHours, HoursReason, MemberHours } from '@/types/hours';

defineOptions({ name: 'HoursPage' });
const active = ref(true);
const requestedKey = ref('');
const store = useSettings();
const calendar = useChinaCalendar();
const credentials = useCredentials();
const hours = useHours();
const fixtureMode = import.meta.env.VITE_HOURS_FIXTURE === '1';
const today = ref(shanghaiToday());
const range = ref<DateRange>(currentMonthRange(new Date(today.value + 'T12:00:00')));
const startInput = ref(range.value.start), endInput = ref(range.value.end);
const rangeError = ref(''), rangeNote = ref(''), startupError = ref(''), linkError = ref('');
const ready = ref(false);
const memberFilter = ref(''), anomalyFilter = ref('all');
const selectedStaff = ref(''), selectedDate = ref(''), detailProject = ref('');
const detailsElement = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const settings = computed(() => store.settings.value.hours ?? createHoursSettings());
const fixture = computed(() => createHoursFixture(today.value));
const members = computed(() => fixtureMode ? fixture.value.members : store.settings.value.members);
const projects = computed(() => fixtureMode ? fixture.value.projects : store.enabledProjects.value);
const query = computed(() => ({ projects: store.enabledProjects.value, members: store.settings.value.members, range: range.value, today: today.value, settings: settings.value, credentialRevision: credentials.credentialRevision.value }));
const queryKey = computed(() => hoursQueryKey(query.value));
const canLoad = computed(() => !fixtureMode && isTauriRuntime() && credentials.status.value.configured && projects.value.length > 0 && members.value.length > 0);
const snapshot = computed(() => fixtureMode ? fixture.value.snapshot : canLoad.value && hours.loadedKey.value === queryKey.value ? hours.snapshot.value : null);
const calendarYears = computed(() => calendarYearsForRanges([range.value, ...calendarTaskRanges(snapshot.value?.tasks.filter(task => !isHoursCompleted(task, settings.value)) ?? [], today.value)]));
const calendarWarnings = computed(() => calendar.warningsFor(calendarYears.value.required));
watch([ready, active, calendar.enabled, calendar.currentYear, () => calendarYears.value.sources.join(',')], () => {
  if (ready.value && active.value && calendar.enabled.value) void calendar.ensure([calendar.currentYear.value, ...calendarYears.value.sources]);
});
const calculator = createHoursCalculator();
const calculatedRows = shallowRef<MemberHours[]>([]);
const calculating = ref(false), calculationError = ref('');
let calculationId = 0;
const calculationKey = computed(() => JSON.stringify({ settings: settings.value, members: members.value, range: range.value, today: today.value, calendar: calendar.days.value }));
const calculatedSnapshot = shallowRef<typeof snapshot.value>(null);
const calculatedKey = ref('');
const rows = computed(() => snapshot.value && calculatedSnapshot.value === snapshot.value && calculatedKey.value === calculationKey.value ? calculatedRows.value : []);
let allowedCalculationKey = calculationKey.value;
let runningSnapshot: typeof snapshot.value = null;
let runningKey = '';
watch([snapshot, calculationKey, active], async () => {
  if (active.value) allowedCalculationKey = calculationKey.value;
  if (!active.value && (!snapshot.value || allowedCalculationKey !== calculationKey.value)) return;
  if (snapshot.value && ((calculatedSnapshot.value === snapshot.value && calculatedKey.value === calculationKey.value) || (calculating.value && runningSnapshot === snapshot.value && runningKey === calculationKey.value))) return;
  const id = ++calculationId;
  if (!snapshot.value) calculator.cancel();
  if (!snapshot.value) { calculating.value = false; calculatedRows.value = []; return; }
  calculating.value = true; calculationError.value = '';
  const source = snapshot.value, key = calculationKey.value;
  runningSnapshot = source; runningKey = key;
  try {
    const result = await calculator.calculate({ snapshot: source, members: members.value, settings: settings.value, range: range.value, today: today.value, calendar: calendar.days.value });
    if (id !== calculationId) return;
    calculatedSnapshot.value = source; calculatedKey.value = key; calculatedRows.value = result.rows ?? [];
    console.info('[hours-performance]', { ...source.metrics, calculationMs: result.calculationMs });
  } catch (error) { if (id === calculationId && !(error instanceof DOMException && error.name === 'AbortError')) calculationError.value = String(error); }
  finally { if (id === calculationId) calculating.value = false; }
}, { immediate: true });
const memberRows = computed(() => rows.value.filter(row => !memberFilter.value || row.member.staffId === memberFilter.value));
const visibleRows = computed(() => memberRows.value.filter(row => {
  switch(anomalyFilter.value) {
    case 'historical': return row.historicalShortDays > 0;
    case 'forecast': return row.forecastShortDays > 0;
    case 'over': return row.days.some(day => day.state === 'over');
    case 'unknown': return row.days.some(day => day.reasons.length > 0) || row.pending.some(item => !item.overdue);
    default: return true;
  }
}));
const matrixElement = ref<HTMLElement | null>(null);
const viewport = ref({ top: 0, left: 0, width: 1000, height: 600 });
let resizeObserver: ResizeObserver | undefined;
let scrollFrame = 0;
function measureMatrix(): void {
  const element = matrixElement.value;
  if (element) viewport.value = { top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth || 1000, height: element.clientHeight || 600 };
}
function matrixScroll(): void { if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; measureMatrix(); }); }
watch(matrixElement, element => {
  resizeObserver?.disconnect();
  if (element && active.value) { measureMatrix(); if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(measureMatrix); resizeObserver.observe(element); } }
});
const dates = computed(() => eachDateKey(range.value));
const windowBounds = computed(() => matrixWindow(visibleRows.value.length, dates.value.length, viewport.value.top, viewport.value.left, viewport.value.height, viewport.value.width));
const renderedRows = computed(() => visibleRows.value.slice(windowBounds.value.rowStart, windowBounds.value.rowEnd));
const renderedDates = computed(() => dates.value.slice(windowBounds.value.columnStart, windowBounds.value.columnEnd));
const spacerColumns = computed(() => renderedDates.value.length + 1 + Number(windowBounds.value.left > 0) + Number(windowBounds.value.right > 0));
const weekdayFormat = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' });
const dateNames = computed(() => new Map(dates.value.map(date => [date, weekdayFormat.format(new Date(date + 'T00:00:00Z'))])));
const pendingSummaries = computed(() => new Map(rows.value.map(row => [row.member.staffId, { overdue: row.pending.filter(item => item.overdue).length, waiting: row.pending.filter(item => !item.overdue).length, remaining: formatHours(row.pending.reduce((sum, item) => sum + (item.hours ?? 0), 0)) }])));
const detailLimit = ref(50);
watch([selectedStaff, selectedDate, detailProject], () => { detailLimit.value = 50; });
const summary = computed(() => {
  const days = memberRows.value.flatMap(row => row.days);
  return { historicalPeople: memberRows.value.filter(row => row.historicalShortDays).length, historical: days.filter(day => day.basis === 'actual' && day.state === 'short').length, forecastPeople: memberRows.value.filter(row => row.forecastShortDays).length, forecast: days.filter(day => day.basis === 'forecast' && day.state === 'short').length, over: days.filter(day => day.state === 'over').length, unknown: days.filter(day => day.reasons.length > 0).length };
});
const selectedRow = computed(() => rows.value.find(row => row.member.staffId === selectedStaff.value));
const selectedDay = computed(() => selectedRow.value?.days.find(day => day.date === selectedDate.value));
const taskMap = computed(() => new Map(snapshot.value?.tasks.map(task => [hoursTaskKey(task), task])));
const contributions = computed(() => selectedDay.value?.contributions.filter(item => !detailProject.value || item.projectId === detailProject.value) ?? []);
const pending = computed(() => selectedRow.value?.pending.filter(item => !detailProject.value || item.task.projectId === detailProject.value) ?? []);
const issueMessages = computed(() => [...new Set(snapshot.value?.issues.map(formatReason))]);
const loadError = computed(() => hours.failureIssues.value.length ? hours.failureIssues.value.map(formatReason).join('；') : hours.error.value);
const emptyMessage = computed(() => {
  if (calculationError.value) return '工时计算失败，请刷新重试。';
  if (calculating.value && !rows.value.length) return '正在后台计算每日工时…';
  if (fixtureMode) return '';
  if (!ready.value) return '正在读取配置…';
  if (!isTauriRuntime()) return '真实工时数据请在桌面端加载。';
  if (!credentials.status.value.configured) return '请先在设置中配置 TAPD 令牌。';
  if (!projects.value.length) return '请先启用至少一个项目。';
  if (!members.value.length) return '请先配置展示成员。';
  if (hours.loading.value && !snapshot.value) return '正在加载成员工作项及工时记录…';
  return !snapshot.value ? '尚无当前范围的有效工时数据。' : '';
});
// 配色仅反映已知工时与日期，完整性和超额仍由原业务状态表达。
function cellTone(day: DailyHours): string {
  if (day.target === 0) return 'nonworking';
  if (day.total + 1e-9 >= day.target) return 'enough';
  return day.date < today.value ? 'historical-short' : 'forecast-short';
}
function daySummary(day: DailyHours): string {
  return day.state === 'exempt' && day.total === 0 ? stateLabel(day) : (day.basis === 'actual' ? '实际 ' : '预计 ') + formatHours(day.total) + 'h';
}
function stateLabel(day: DailyHours): string {
  if (day.state === 'exempt') return isLeaveExempt(day) ? '请假豁免' : '非工作日';
  if (day.state === 'unknown') return '待确认';
  if (day.state === 'short') return '缺 ' + formatHours(day.deficit) + 'h';
  if (day.basis === 'forecast' && day.actual >= day.target) return '实际已达标';
  if (day.state === 'over') return '排期超额 +' + formatHours(day.total - day.target) + 'h';
  return day.basis === 'actual' ? '达标' : '预计充足';
}
function isLeaveExempt(day: DailyHours): boolean {
  return day.target === 0 && day.leaveHours > 0 && isWorkingDay(day.date, calendar.days.value);
}
function dayName(date: string): string {
  return dateNames.value.get(date) ?? '';
}
function applyRange(): void {
  const result = validateRange(startInput.value, endInput.value);
  rangeError.value = result.error;
  rangeNote.value = result.note;
  if (result.range) { range.value = result.range; startInput.value = result.range.start; endInput.value = result.range.end; }
}
async function select(staffId: string, date: string, event: MouseEvent): Promise<void> {
  returnFocus = event.currentTarget as HTMLElement;
  selectedStaff.value = staffId; selectedDate.value = date; detailProject.value = ''; linkError.value = '';
  await nextTick(); detailsElement.value?.focus();
}
function closeDetails(): void { selectedStaff.value = ''; returnFocus?.focus(); }
function contributionTitle(key: string): string { return taskMap.value.get(key)?.title ?? (key.split(':')[1] === 'bug' ? '缺陷 ' : '任务 ') + key.split(':').slice(2).join(':'); }
function projectName(id: string): string { return projects.value.find(project => project.id === id)?.name ?? id; }
function formatReason(reason: HoursReason): string { return reason.projectId ? projectName(reason.projectId) + '：' + reason.message : reason.message; }
function contributionUrl(key: string): string { const [projectId, type, ...id] = key.split(':'); return buildTapdUrl(projectId, type === 'bug' ? 'bug' : 'task', id.join(':')); }
async function openLink(url: string): Promise<void> {
  linkError.value = '';
  try { await openExternalUrl(url); } catch(error) { linkError.value = '打开 TAPD 失败：' + String(error); }
}
async function refresh(force = false): Promise<void> {
  if (!canLoad.value) return;
  requestedKey.value = queryKey.value;
  await hours.refresh(query.value, force);
}
function updateToday(): void { if (active.value) today.value = shanghaiToday(); }
watch([ready, queryKey, canLoad, active], () => {
  if (!ready.value || !active.value) return;
  if (!canLoad.value) { hours.invalidate(); return; }
  if (requestedKey.value !== queryKey.value) {
    selectedStaff.value = '';
    void refresh();
  }
});
let savedScroll = { top: 0, left: 0 };
onDeactivated(() => {
  active.value = false;
  savedScroll = { top: matrixElement.value?.scrollTop ?? viewport.value.top, left: matrixElement.value?.scrollLeft ?? viewport.value.left };
  resizeObserver?.disconnect();
  cancelAnimationFrame(scrollFrame); scrollFrame = 0;
});
onActivated(async () => {
  active.value = true; updateToday();
  await nextTick();
  const element = matrixElement.value;
  if (element) {
    element.scrollTop = savedScroll.top; element.scrollLeft = savedScroll.left;
    resizeObserver?.observe(element); measureMatrix();
  }
});
onMounted(async () => {
  timer = setInterval(updateToday, 60000);
  window.addEventListener('focus', updateToday);
  document.addEventListener('visibilitychange', updateToday);
  try { await store.load(); if (!fixtureMode) await credentials.refresh(); }
  catch(error) { startupError.value = '读取配置失败：' + String(error); }
  ready.value = true;
});
onUnmounted(() => { clearInterval(timer); window.removeEventListener('focus', updateToday); document.removeEventListener('visibilitychange', updateToday); hours.invalidate(); calculationId++; calculator.cancel(); resizeObserver?.disconnect(); cancelAnimationFrame(scrollFrame); });
</script>

<template>
  <div class="hours" @keydown.esc="closeDetails">
    <header class="hours-header">
      <div><h1>每日工时</h1><p>过去看实际填报，今天与未来看预计排期 · 规定 {{ settings.dailyRequiredHours }}h／工作日 · 北京时间</p></div>
      <RouterLink to="/settings">配置工时规则</RouterLink>
    </header>
    <form class="filters" @submit.prevent="applyRange">
      <label>开始日期 <input v-model="startInput" type="date" aria-label="开始日期" /></label>
      <label>结束日期 <input v-model="endInput" type="date" aria-label="结束日期" /></label>
      <button type="submit">应用日期</button>
      <label>成员 <select v-model="memberFilter" aria-label="成员筛选"><option value="">全部成员</option><option v-for="member in members" :key="member.staffId" :value="member.staffId">{{ member.name }}</option></select></label>
      <label>关注 <select v-model="anomalyFilter" aria-label="异常筛选"><option value="all">全部情况</option><option value="historical">历史实际不足</option><option value="forecast">预计排期不足</option><option value="over">排期超额</option><option value="unknown">待确认</option></select></label>
      <button type="button" :disabled="!canLoad || hours.loading.value" @click="refresh(true)">{{ hours.loading.value ? '加载中…' : '刷新' }}</button>
    </form>
    <p v-if="rangeError || startupError || credentials.loadError.value || loadError || calculationError" class="error" role="alert">{{ rangeError || startupError || credentials.loadError.value || loadError || calculationError }}</p>
    <p v-if="hours.progress.value" role="status" class="meta">{{ hours.progress.value.stage }} · {{ hours.progress.value.completed }}／{{ hours.progress.value.total }}</p>
    <p v-if="calculating" role="status" class="meta">正在后台计算每日工时…</p>
    <p v-if="rangeNote" class="notice">{{ rangeNote }}</p>
    <p v-if="calendarWarnings.length" class="notice" role="status">{{ calendarWarnings.join('；') }} <RouterLink to="/settings">前往设置查看日历状态</RouterLink></p>
    <p v-if="fixtureMode" class="notice">演示数据，不访问 TAPD。</p>
    <p v-if="hours.stale.value && hours.snapshot.value" class="notice">当前显示上次加载的旧数据。{{ hours.loadedKey.value !== queryKey ? '旧数据与当前范围不一致，已隐藏。' : '刷新成功后更新。' }}</p>
    <p v-if="hours.lastLoadedAt.value" class="meta">最后成功加载：{{ hours.lastLoadedAt.value }} · 全部已启用项目，任务与缺陷 · 切换范围可复用 1 分钟内缓存，刷新重新获取</p>
    <details v-if="issueMessages.length" class="notice"><summary>数据不完整：{{ issueMessages.length }} 项，受影响日期标记待确认</summary><ul><li v-for="message in issueMessages" :key="message">{{ message }}</li></ul></details>
    <div v-if="rows.length" class="summary" aria-label="工时汇总">
      <div><span>历史实际不足</span><strong>{{ summary.historicalPeople }} 人 · {{ summary.historical }} 人日</strong></div>
      <div><span>预计排期不足</span><strong>{{ summary.forecastPeople }} 人 · {{ summary.forecast }} 人日</strong></div>
      <div><span>排期超额</span><strong>{{ summary.over }} 人日</strong></div>
      <div><span>数据待确认</span><strong>{{ summary.unknown }} 人日</strong></div>
    </div>
    <p v-if="emptyMessage" class="empty">{{ emptyMessage }} <RouterLink v-if="ready && !canLoad" to="/settings">前往设置</RouterLink></p>
    <div v-else class="content">
      <section ref="matrixElement" class="matrix" aria-label="成员每日工时矩阵" @scroll.passive="matrixScroll">
        <table :class="{ 'virtual-table': windowBounds.virtual }" :style="windowBounds.virtual ? { width: (200 + dates.length * MATRIX_COLUMN_WIDTH) + 'px' } : undefined" :aria-rowcount="visibleRows.length + 1" :aria-colcount="dates.length + 1">
          <thead><tr><th class="member-column">成员</th><th v-if="windowBounds.left" class="spacer" aria-hidden="true" :style="{ width: windowBounds.left + 'px' }"></th><th v-for="date in renderedDates" :key="date" :class="{ 'today-column': date === today }"><strong>{{ date.slice(5) }}</strong><span>{{ dayName(date) }} · {{ date < today ? '实际' : date === today ? '今天' : '预计' }}</span></th><th v-if="windowBounds.right" class="spacer" aria-hidden="true" :style="{ width: windowBounds.right + 'px' }"></th></tr></thead>
          <tbody>
            <tr v-if="windowBounds.top" aria-hidden="true"><td class="spacer" :colspan="spacerColumns" :style="{ height: windowBounds.top + 'px' }"></td></tr>
            <tr v-for="(row, rowIndex) in renderedRows" :key="row.member.staffId" class="data-row" :aria-rowindex="windowBounds.rowStart + rowIndex + 2" :style="windowBounds.virtual ? { height: MATRIX_ROW_HEIGHT + 'px' } : undefined">
              <th class="member-column"><strong>{{ row.member.name }}</strong><span>历史不足 {{ row.historicalShortDays }} 天<br />预计不足 {{ row.forecastShortDays }} 天</span><button v-if="row.pending.length" type="button" class="pending-button" @click="select(row.member.staffId, '', $event)">逾期待安排 {{ row.pending.filter(item => item.overdue).length }} 项<br />待确认／待安排 {{ row.pending.filter(item => !item.overdue).length }} 项<br />已知剩余 {{ pendingSummaries.get(row.member.staffId)?.remaining }}h</button></th>
              <td v-if="windowBounds.left" class="spacer" aria-hidden="true" :style="{ width: windowBounds.left + 'px' }"></td><td v-for="day in row.days.slice(windowBounds.columnStart, windowBounds.columnEnd)" :key="day.date"><button type="button" class="day-cell" :class="['tone-' + cellTone(day), { selected: selectedStaff === row.member.staffId && selectedDate === day.date }]" :data-state="day.state" :aria-label="row.member.name + ' ' + day.date + ' ' + daySummary(day) + (day.state === 'exempt' && day.total === 0 ? '' : ' ' + stateLabel(day)) + (day.leaveHours > 0 ? ' 请假 ' + formatHours(day.leaveHours) + 'h 目标 ' + formatHours(day.target) + 'h' : '') + (day.reasons.length ? ' 当日数据待确认 ' + day.reasons.length + '个原因' : '')" @click="select(row.member.staffId, day.date, $event)"><strong>{{ daySummary(day) }}</strong><span v-if="day.state !== 'exempt' || day.total > 0">{{ stateLabel(day) }}</span><small v-if="day.leaveHours > 0">请假 {{ formatHours(day.leaveHours) }}h · 目标 {{ formatHours(day.target) }}h</small><small v-if="day.reasons.length" class="data-warning">当日数据待确认 · {{ day.reasons.length }}个原因</small><small v-if="day.date === today && (day.state !== 'exempt' || day.total > 0)">已填报 {{ formatHours(day.actual) }}h</small></button></td>
              <td v-if="windowBounds.right" class="spacer" aria-hidden="true" :style="{ width: windowBounds.right + 'px' }"></td>
            </tr>
            <tr v-if="windowBounds.bottom" aria-hidden="true"><td class="spacer" :colspan="spacerColumns" :style="{ height: windowBounds.bottom + 'px' }"></td></tr>
          </tbody>
        </table>
        <p v-if="!visibleRows.length" class="empty">没有符合筛选条件的成员。</p>
      </section>
      <aside v-if="selectedRow" ref="detailsElement" class="details" tabindex="-1" aria-label="工时明细">
        <header><h2>{{ selectedRow.member.name }} · {{ selectedDate || '待安排任务' }}</h2><button type="button" aria-label="关闭工时明细" @click="closeDetails">关闭</button></header>
        <template v-if="selectedDay"><p class="detail-total">{{ daySummary(selectedDay) }}{{ selectedDay.state === 'exempt' && selectedDay.total === 0 ? '' : ' · ' + stateLabel(selectedDay) }}</p><p v-if="selectedDay.leaveHours > 0">请假 {{ formatHours(selectedDay.leaveHours) }}h · 当日目标 {{ formatHours(selectedDay.target) }}h</p><p v-if="selectedDay.state === 'exempt'">{{ isLeaveExempt(selectedDay) ? '请假已抵扣当日规定工时，不判断不足或超额。' : '非工作日不受每日规定工时约束，不判断不足或超额。' }}<br />实际 {{ formatHours(selectedDay.actual) }}h ＋ {{ isLeaveExempt(selectedDay) ? '剩余分配' : '加班分配' }} {{ formatHours(selectedDay.allocated) }}h</p><p v-else>实际 {{ formatHours(selectedDay.actual) }}h ＋ 剩余分配 {{ formatHours(selectedDay.allocated) }}h<br />当日目标 {{ formatHours(selectedDay.target) }}h</p><p v-if="selectedDay.basis === 'forecast' && selectedDay.state !== 'exempt'" class="notice">当前预计值由已填报工时与可计算的剩余排期组成，不代表实际已达标。</p><p v-if="selectedDay.reasons.length" class="notice">当日数据待确认 · {{ selectedDay.reasons.length }}个原因。{{ selectedDay.state === 'exempt' ? (isLeaveExempt(selectedDay) ? '仅影响工时数据完整性，请假豁免日不判断不足或超额。' : '仅影响工时数据完整性，非工作日不判断不足或超额。') : selectedDay.actual >= selectedDay.target && selectedDay.target > 0 ? '已记录的实际工时已达到目标。' : selectedDay.total >= selectedDay.target && selectedDay.target > 0 ? '当前已知工时达到目标，预计分配仍可能随数据补全调整。' : '当前已知工时未达到目标，数据补全前不能确定不足。' }}</p><ul v-if="selectedDay.reasons.length" class="error"><li v-for="reason in selectedDay.reasons" :key="JSON.stringify(reason)">{{ formatReason(reason) }}</li></ul></template>
        <label>明细项目 <select v-model="detailProject" aria-label="明细项目筛选"><option value="">全部项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
        <p class="meta">项目筛选仅影响明细，全天汇总保持不变。</p>
        <template v-if="selectedDay"><article v-for="item in contributions.slice(0, detailLimit)" :key="item.taskKey"><span class="meta">{{ projectName(item.projectId) }} · {{ taskMap.get(item.taskKey)?.status || '历史填报' }}</span><h3>{{ contributionTitle(item.taskKey) }}</h3><p>实际 {{ formatHours(item.actual) }}h · 当天分配 {{ formatHours(item.allocated) }}h</p><p class="meta">{{ item.explanation }}</p><a :href="contributionUrl(item.taskKey)" @click.prevent="openLink(contributionUrl(item.taskKey))">打开 TAPD</a></article><p v-if="!contributions.length" class="meta">当天没有对应项目的有效工时贡献。</p></template>
        <template v-else><article v-for="item in pending.slice(0, detailLimit)" :key="hoursTaskKey(item.task)"><span class="meta">{{ projectName(item.task.projectId) }} · {{ item.task.status }}</span><h3>{{ item.task.title }}</h3><p>剩余 {{ item.hours === null ? '待确认' : formatHours(item.hours) + 'h' }} · {{ item.reason }}</p><a :href="item.task.tapdUrl" @click.prevent="openLink(item.task.tapdUrl)">打开 TAPD</a></article></template>
        <button v-if="(selectedDay ? contributions.length : pending.length) > detailLimit" type="button" @click="detailLimit += 50">显示更多明细</button>
        <p v-if="linkError" role="alert" class="error">{{ linkError }}</p>
      </aside>
    </div>
    <p class="legend">绿色：达到目标；红色：历史不足；橙色：今天／未来预计不足；灰色：非工作日／请假豁免。数据待确认单独提示。工时按已配置成员展示，多人任务按全部负责人份额计算。</p>
  </div>
</template>

<style scoped>
.hours { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.hours-header, .details header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h1 { margin: 0 0 4px; font-size: 20px; } h2 { margin: 0; font-size: 15px; } h3 { margin: 6px 0; font-size: 13px; }
p { margin: 0; } .hours-header p, .meta, .legend { font-size: 12px; color: var(--ts-color-text-muted); }
a { color: #1d4ed8; } .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
input, select, button { padding: 5px 8px; border: 1px solid var(--ts-color-border-strong); border-radius: 4px; color: var(--ts-color-text); background: var(--ts-color-surface); font-size: 12px; }
button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; }
.summary { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
.summary > div { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--ts-color-border); border-radius: var(--ts-radius); background: var(--ts-color-surface); }
.summary span { font-size: 12px; color: var(--ts-color-text-muted); } .summary strong { font-size: 16px; }
.content { display: flex; flex: 1; min-height: 0; gap: 12px; } .matrix { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--ts-color-border); border-radius: var(--ts-radius); background: var(--ts-color-surface); }
table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; }
th, td { border-right: 1px solid var(--ts-color-border); border-bottom: 1px solid var(--ts-color-border); padding: 6px; vertical-align: top; }
thead th { position: sticky; top: 0; z-index: 2; text-align: center; background: var(--ts-color-surface); min-width: 130px; }
th strong, th span { display: block; } th span { color: var(--ts-color-text-muted); font-size: 11px; font-weight: normal; margin-top: 5px; }
.member-column { position: sticky; left: 0; z-index: 1; min-width: 175px; width: 175px; text-align: left; background: var(--ts-color-surface); padding: 12px; }
thead .member-column { z-index: 3; } .today-column { box-shadow: inset 0 -3px #2563eb; }
.day-cell { width: 100%; min-width: 130px; min-height: 78px; display: flex; flex-direction: column; gap: 5px; align-items: flex-start; text-align: left; border-color: transparent; padding: 9px; }
.day-cell strong { font-size: 13px; }.day-cell small { color: inherit; }
.tone-historical-short { background: #fff1f2; color: #9f1239; }
.tone-enough { background: #ecfdf5; color: #065f46; }
.tone-forecast-short { background: #fff7ed; color: #9a3412; }
.tone-nonworking { background: #f1f5f9; color: #475569; }
.data-warning { color: #92400e; }
.day-cell.selected { outline: 2px solid #2563eb; outline-offset: -2px; } .pending-button { margin-top: 8px; color: #92400e; text-align: left; font-size: 11px; }
.details { flex: 0 0 330px; max-width: 40vw; overflow: auto; padding: 14px; border: 1px solid var(--ts-color-border); border-radius: var(--ts-radius); background: var(--ts-color-surface); }
.details > * { margin-bottom: 12px; }.details article { border-top: 1px solid var(--ts-color-border); padding: 12px 0; }.details article p { margin: 6px 0; }.detail-total { font-weight: 600; font-size: 16px; }
.notice { padding: 8px 10px; background: #fffbeb; color: #92400e; font-size: 12px; }.error { color: #b91c1c; font-size: 12px; }.empty { padding: 24px; text-align: center; color: var(--ts-color-text-muted); }
.virtual-table { table-layout: fixed; }
.virtual-table .member-column { box-sizing: border-box; width: 200px; min-width: 200px; max-width: 200px; }
.virtual-table th:not(.member-column):not(.spacer), .virtual-table td:not(.spacer) { width: 144px; min-width: 144px; box-sizing: border-box; }
.virtual-table thead th { height: 60px; box-sizing: border-box; }
.virtual-table .day-cell { min-width: 0; }
.virtual-table .data-row > th, .virtual-table .data-row > td { height: 144px; max-height: 144px; }
.virtual-table .member-column strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.virtual-table .spacer { padding: 0; border: 0; min-width: 0; }
@media(max-width: 900px) { .summary { grid-template-columns: repeat(2, minmax(0,1fr)); } .content { flex-direction: column; }.details { flex: 0 0 40%; max-width: none; } }
</style>
