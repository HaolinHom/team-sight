import { type DateRange } from './date.js';
import type { HoursSettings, HoursSnapshot, MemberHours } from './hoursTypes.js';
import type { MemberEntry } from './types.js';
import type { ScheduleTask } from './types.js';
import { type WorkingCalendar } from './calendar.js';
export declare const hoursTaskKey: (task: Pick<ScheduleTask, "projectId" | "sourceType" | "id">) => string;
export declare function parseHours(value: unknown): number | null;
export declare function formatHours(value: number): string;
export declare function calculateHours(input: {
    snapshot: HoursSnapshot;
    members: readonly MemberEntry[];
    settings: HoursSettings;
    range: DateRange;
    today: string;
    calendar?: WorkingCalendar;
}): MemberHours[];
