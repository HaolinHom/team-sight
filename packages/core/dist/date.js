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
