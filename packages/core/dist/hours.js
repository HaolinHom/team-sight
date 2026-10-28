import { eachDateKey, isWeekend } from './date.js';
export function summarizeDailyHours(input) {
    const totals = new Map();
    for (const record of input.records)
        if (record.staffId === input.staffId)
            totals.set(record.spentDate, (totals.get(record.spentDate) ?? 0) + record.hours);
    const leaves = new Map(input.settings.exemptions.filter(item => item.staffId === input.staffId).map(item => [item.date, item.hours]));
    return eachDateKey(input.range).map(date => {
        const working = input.calendar?.[date]?.working ?? !isWeekend(date);
        const target = working ? Math.max(input.settings.dailyRequiredHours - (leaves.get(date) ?? 0), 0) : 0;
        const actual = totals.get(date) ?? 0;
        const deficit = Math.max(target - actual, 0);
        const state = target === 0 ? 'exempt' : actual < target ? 'short' : actual > target ? 'over' : 'enough';
        return { date, target, actual, deficit, state };
    });
}
