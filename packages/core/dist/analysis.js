import { assertRange, isValidDateKey } from './date.js';
import { isHoursCompleted } from './hoursSettings.js';
import { hoursTaskKey, parseHours } from './statistics.js';
export const RULES_VERSION = 'teamsight-hours-v1.2';
export const MCP_RULES_VERSION = 'teamsight-mcp-hours-v2';
export function validateAnalysisInput(range, analysisDate) {
    assertRange(range);
    if (!isValidDateKey(analysisDate))
        throw new RangeError('INVALID_ANALYSIS_DATE');
}
export function checkRisks(snapshot, members, settings, today, policy = 'legacy') {
    const findings = [];
    for (const { member, days } of members)
        for (const day of days) {
            // The open business day reports progress; uncertain sources cannot prove a deficit.
            if (day.state !== 'short' || day.reasons.length || policy === 'legacy' && day.date === today)
                continue;
            const historical = day.date < today;
            findings.push({ code: historical ? 'HISTORICAL_HOURS_SHORT' : 'FORECAST_SHORT',
                message: `${member.name} ${day.date} ${historical ? '已填报' : '预计'}工时不足，差 ${day.deficit} 小时`,
                staffId: member.staffId, date: day.date,
                evidence: day.contributions.length ? day.contributions.map(c => c.taskKey) : [`daily:${member.staffId}:${day.date}`],
            });
        }
    for (const task of snapshot.tasks) {
        if (isHoursCompleted(task, settings.hours))
            continue;
        const key = hoursTaskKey(task);
        const base = { taskKey: key, evidence: [key] };
        if (!task.startDate || !task.dueDate || task.startDate > task.dueDate)
            findings.push({ ...base, code: 'MISSING_SCHEDULE', message: `「${task.title}」缺少有效排期` });
        if (parseHours(task.effort) === null)
            findings.push({ ...base, code: 'MISSING_ESTIMATE', message: `「${task.title}」缺少有效预估工时` });
        if (task.dueDate && task.dueDate < today)
            findings.push({ ...base, code: 'OVERDUE', message: `「${task.title}」未结束且已逾期`, date: task.dueDate });
    }
    return findings;
}
