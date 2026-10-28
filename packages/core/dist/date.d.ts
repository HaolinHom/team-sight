import type { DateRange } from './types.js';
export declare function isValidDateKey(value: unknown): value is string;
export declare function dateDiffInDays(from: string, to: string): number;
export declare function addDays(value: string, days: number): string;
export declare function eachDateKey(range: DateRange): string[];
export declare function currentMonthRange(now?: Date): DateRange;
export declare function isWeekend(value: string): boolean;
