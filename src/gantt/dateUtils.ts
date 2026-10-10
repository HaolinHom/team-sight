/**
 * 日期工具：所有日期键均为 `YYYY-MM-DD` 自然日字符串。
 *
 * 实现上统一使用 UTC 零点构造日期，避免本地时区/夏令时导致天数差偏移；
 * `todayKey` 例外：用户视角的"今天"取本地日期。
 */

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateRange {
  start: string;
  end: string;
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const matched = DATE_KEY_PATTERN.exec(value);
  if (!matched) return false;

  const [, year, month, day] = matched;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return formatDateKey(date) === value;
}

function parseDateKey(value: string): Date {
  if (!isValidDateKey(value)) {
    throw new RangeError(`非法日期：${value}（要求 YYYY-MM-DD）`);
  }
  const [, year, month, day] = DATE_KEY_PATTERN.exec(value)!;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, days: number): string {
  const date = parseDateKey(value);
  return formatDateKey(new Date(date.getTime() + days * MS_PER_DAY));
}

/** 天数差：`to - from`，用于 `x(d) = diff * dayColumnWidth`。 */
export function dateDiffInDays(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / MS_PER_DAY);
}

/** 本地"今天"，用于日历上的当日标记。 */
export function todayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 默认时间范围：当前自然月。 */
export function currentMonthRange(now: Date = new Date()): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = formatDateKey(new Date(Date.UTC(year, month, 1)));
  const end = formatDateKey(new Date(Date.UTC(year, month + 1, 0)));
  return { start, end };
}

export function eachDateKey(range: DateRange): string[] {
  const total = dateDiffInDays(range.start, range.end);
  const keys: string[] = [range.start];
  for (let index = 1; index <= total; index += 1) {
    keys.push(addDays(range.start, index));
  }
  return keys;
}

export function isWeekend(dateKey: string): boolean {
  const weekday = parseDateKey(dateKey).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function compareDateKeys(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

export function maxDateKey(left: string, right: string): string {
  return dateDiffInDays(left, right) >= 0 ? right : left;
}

export function minDateKey(left: string, right: string): string {
  return dateDiffInDays(left, right) >= 0 ? left : right;
}
