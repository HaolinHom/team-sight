import { dateDiffInDays, isValidDateKey, isWeekend } from './date.js';
export const createChinaCalendarSettings = () => ({ enabled: false, years: {} });
export const isCalendarYear = (year) => Number.isInteger(year) && year >= 1000 && year <= 9999;
export function parseHolidayYear(raw, year) {
    if (!raw || typeof raw !== 'object')
        throw new Error('节假日数据不是有效对象');
    const value = raw;
    if (!isCalendarYear(year) || value.year !== year || !Array.isArray(value.days) || !value.days.length || !Array.isArray(value.papers) || !value.papers.length || value.papers.some(paper => typeof paper !== 'string' || !/^https?:\/\//.test(paper))) {
        throw new Error('节假日数据的年份、日期列表或公告链接无效');
    }
    const days = {};
    for (const item of value.days) {
        if (!item || !isValidDateKey(item.date) || ![year, year - 1].includes(Number(item.date.slice(0, 4))) || typeof item.isOffDay !== 'boolean' || typeof item.name !== 'string' || !item.name.trim() || days[item.date]) {
            throw new Error('节假日数据包含无效或重复日期');
        }
        days[item.date] = { working: !item.isOffDay, name: item.name };
    }
    return { year, days, papers: [...value.papers] };
}
export function normalizeChinaCalendar(raw) {
    const result = createChinaCalendarSettings();
    if (!raw || typeof raw !== 'object')
        return result;
    const value = raw;
    result.enabled = value.enabled === true;
    if (value.years && typeof value.years === 'object') {
        for (const [key, cache] of Object.entries(value.years)) {
            try {
                if (!cache || cache.year !== Number(key) || typeof cache.fetchedAt !== 'string' || !Number.isFinite(Date.parse(cache.fetchedAt)) || !cache.days || typeof cache.days !== 'object')
                    continue;
                const parsed = parseHolidayYear({ year: cache.year, papers: cache.papers, days: Object.entries(cache.days).map(([date, day]) => ({ date, name: day?.name, isOffDay: typeof day?.working === 'boolean' ? !day.working : undefined })) }, Number(key));
                result.years[key] = { ...parsed, fetchedAt: cache.fetchedAt };
            }
            catch { /* 损坏缓存视为未获取，不影响其他年份与开关。 */ }
        }
    }
    return result;
}
export function mergeCalendar(settings) {
    if (!settings.enabled)
        return {};
    return Object.assign({}, ...Object.values(settings.years).sort((a, b) => a.year - b.year).map(cache => cache.days));
}
export function isWorkingDay(date, calendar = {}) {
    return calendar[date]?.working ?? !isWeekend(date);
}
export function calendarYearsForRanges(ranges) {
    const required = new Set(), sources = new Set();
    for (const range of ranges) {
        if (!isValidDateKey(range.start) || !isValidDateKey(range.end) || range.start > range.end)
            continue;
        for (let year = Number(range.start.slice(0, 4)); year <= Number(range.end.slice(0, 4)); year++) {
            if (!isCalendarYear(year))
                continue;
            required.add(year);
            sources.add(year);
            if (range.start <= `${year}-12-31` && range.end >= `${year}-12-01` && isCalendarYear(year + 1))
                sources.add(year + 1);
        }
    }
    return { required: [...required].sort(), sources: [...sources].sort() };
}
/** 与统计器的完整区间/从今天起分配区间相同，避免局部查询遗漏跨年日历。 */
export function calendarTaskRanges(tasks, today) {
    const ranges = [];
    for (const task of tasks) {
        if (!isValidDateKey(task.startDate) || !isValidDateKey(task.dueDate) || task.startDate > task.dueDate)
            continue;
        if (dateDiffInDays(task.startDate, task.dueDate) <= 366)
            ranges.push({ start: task.startDate, end: task.dueDate });
        const start = task.startDate > today ? task.startDate : today;
        if (start <= task.dueDate && dateDiffInDays(start, task.dueDate) <= 366)
            ranges.push({ start, end: task.dueDate });
    }
    return ranges;
}
