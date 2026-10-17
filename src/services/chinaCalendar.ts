import { isCalendarYear, parseHolidayYear, type CalendarYearCache } from '@/calendar/chinaCalendar';
import { isTauriRuntime } from './tapd/client';

export async function fetchChinaCalendar(year: number): Promise<CalendarYearCache> {
  if (!isCalendarYear(year)) throw new Error('节假日年份无效');
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const body = await invoke<string>('china_calendar_get', { year });
    return { ...parseHolidayYear(JSON.parse(body), year), fetchedAt: new Date().toISOString() };
  }
  const sources = [
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
  ];
  let failure: unknown;
  for (const url of sources) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { ...parseHolidayYear(await response.json(), year), fetchedAt: new Date().toISOString() };
    } catch (error) { failure = error; }
  }
  throw new Error(`${year} 年节假日获取失败：${String(failure)}`);
}
