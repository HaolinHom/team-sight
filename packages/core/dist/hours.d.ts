import type { DailyHoursSummary, DateRange, HoursSettings, TimesheetRecord } from './types.js';
export declare function summarizeDailyHours(input: {
    range: DateRange;
    settings: HoursSettings;
    records: TimesheetRecord[];
    staffId: string;
    calendar?: Record<string, {
        working: boolean;
    }>;
}): DailyHoursSummary[];
