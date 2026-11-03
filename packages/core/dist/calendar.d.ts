import { type DateRange } from './date.js';
import type { ScheduleTask } from './types.js';
export interface CalendarDay {
    working: boolean;
    name: string;
}
export type WorkingCalendar = Record<string, CalendarDay>;
export interface CalendarYearCache {
    year: number;
    days: WorkingCalendar;
    papers: string[];
    fetchedAt: string;
}
export interface ChinaCalendarSettings {
    enabled: boolean;
    years: Record<string, CalendarYearCache>;
}
export declare const createChinaCalendarSettings: () => ChinaCalendarSettings;
export declare const isCalendarYear: (year: number) => boolean;
export declare function parseHolidayYear(raw: unknown, year: number): Omit<CalendarYearCache, 'fetchedAt'>;
export declare function normalizeChinaCalendar(raw: unknown): ChinaCalendarSettings;
export declare function mergeCalendar(settings: ChinaCalendarSettings): WorkingCalendar;
export declare function isWorkingDay(date: string, calendar?: WorkingCalendar): boolean;
export declare function calendarYearsForRanges(ranges: readonly DateRange[]): {
    required: number[];
    sources: number[];
};
/** 与统计器的完整区间/从今天起分配区间相同，避免局部查询遗漏跨年日历。 */
export declare function calendarTaskRanges(tasks: readonly ScheduleTask[], today: string): DateRange[];
