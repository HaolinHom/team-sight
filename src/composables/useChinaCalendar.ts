import { computed, getCurrentInstance, onMounted, onUnmounted, ref } from 'vue';
import { mergeCalendar, isCalendarYear, type CalendarYearCache } from '@/calendar/chinaCalendar';
import { fetchChinaCalendar } from '@/services/chinaCalendar';
import { shanghaiToday } from '@/hours/settings';
import { useSettings } from './useSettings';

export function createCalendarLoader(options: {
  cached: (year: number) => CalendarYearCache | undefined;
  fetch: (year: number) => Promise<CalendarYearCache>;
  save: (cache: CalendarYearCache) => Promise<boolean>;
  saveError: () => string;
}) {
  const requested = ref<number[]>([]), loading = ref<Record<number, boolean>>({}), errors = ref<Record<number, string>>({});
  const attempted = new Set<number>(), pending = new Map<number, Promise<void>>();
  function refresh(year: number): Promise<void> {
    if (!isCalendarYear(year)) return Promise.resolve();
    if (!requested.value.includes(year)) requested.value = [...requested.value, year];
    const existing = pending.get(year);
    if (existing) return existing;
    attempted.add(year); loading.value[year] = true; errors.value[year] = '';
    const operation = Promise.resolve().then(async () => {
      try {
        const cache = await options.fetch(year);
        if (!await options.save(cache)) throw new Error(options.saveError() || '日历缓存保存失败');
      } catch (error) { errors.value[year] = error instanceof Error ? error.message : String(error); }
      finally { loading.value[year] = false; pending.delete(year); }
    });
    pending.set(year, operation);
    return operation;
  }
  async function ensure(years: readonly number[]): Promise<void> {
    const valid = years.filter(isCalendarYear);
    requested.value = [...new Set([...requested.value, ...valid])];
    await Promise.all(valid.map(year => pending.get(year) ?? (!options.cached(year) && !attempted.has(year) ? refresh(year) : Promise.resolve())));
  }
  return { requested, loading, errors, ensure, refresh };
}

const store = useSettings();
const loader = createCalendarLoader({
  cached: year => store.settings.value.chinaCalendar.years[year],
  fetch: fetchChinaCalendar,
  save: cache => store.cacheChinaCalendarYear(cache),
  saveError: () => store.saveError.value,
});

export function useChinaCalendar() {
  const currentYear = ref(Number(shanghaiToday().slice(0, 4)));
  const enabled = computed(() => store.settings.value.chinaCalendar.enabled);
  const days = computed(() => mergeCalendar(store.settings.value.chinaCalendar));
  const years = computed(() => [...new Set([currentYear.value, ...loader.requested.value, ...Object.keys(store.settings.value.chinaCalendar.years).map(Number)])].sort((a, b) => b - a));
  if (getCurrentInstance()) {
    let timer: ReturnType<typeof setInterval>;
    const update = () => { currentYear.value = Number(shanghaiToday().slice(0, 4)); };
    onMounted(() => { update(); timer = setInterval(update, 60000); window.addEventListener('focus', update); });
    onUnmounted(() => { clearInterval(timer); window.removeEventListener('focus', update); });
  }
  function warningsFor(required: readonly number[]): string[] {
    if (!enabled.value) return [];
    return required.flatMap(year => {
      const cached = store.settings.value.chinaCalendar.years[year], error = loader.errors.value[year];
      if (cached) return error ? [`${year} 年日历刷新失败，继续使用已缓存日历：${error}`] : [];
      return [`${year} 年节假日日历${loader.loading.value[year] ? '获取中' : '未获取'}，暂按周一至周五工作、周末休息处理。${error || ''}`];
    });
  }
  return { ...loader, currentYear, enabled, days, years, warningsFor };
}
