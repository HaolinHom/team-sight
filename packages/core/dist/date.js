const pattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayMs = 86_400_000;
export function isValidDateKey(value) {
    if (typeof value !== 'string')
        return false;
    const match = pattern.exec(value);
    if (!match)
        return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === value;
}
function parse(value) {
    if (!isValidDateKey(value))
        throw new RangeError(`非法日期：${value}`);
    return new Date(`${value}T00:00:00.000Z`);
}
export function dateDiffInDays(from, to) {
    return Math.round((parse(to).getTime() - parse(from).getTime()) / dayMs);
}
export function addDays(value, days) {
    return new Date(parse(value).getTime() + days * dayMs).toISOString().slice(0, 10);
}
export function eachDateKey(range) {
    const total = dateDiffInDays(range.start, range.end);
    if (total < 0)
        return [];
    return Array.from({ length: total + 1 }, (_, index) => addDays(range.start, index));
}
export function currentMonthRange(now = new Date()) {
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    return { start, end };
}
export function isWeekend(value) {
    const weekday = parse(value).getUTCDay();
    return weekday === 0 || weekday === 6;
}
export const compareDateKeys = (left, right) => left === right ? 0 : left === null ? 1 : right === null ? -1 : left < right ? -1 : 1;
export const maxDateKey = (left, right) => left > right ? left : right;
export const minDateKey = (left, right) => left < right ? left : right;
export function todayKey(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function businessDate(timeZone, now = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function assertRange(range) {
    if (!isValidDateKey(range.start) || !isValidDateKey(range.end) || range.start > range.end || dateDiffInDays(range.start, range.end) > 366)
        throw new RangeError('INVALID_RANGE: use an ordered date range of at most 367 days');
}
