import { dateDiffInDays, eachDateKey, isValidDateKey } from './date.js';
import { isHoursCompleted } from './hoursSettings.js';
import { isWorkingDay } from './calendar.js';
const EPSILON = 1e-9;
export const hoursTaskKey = (task) => [task.projectId, task.sourceType, task.id].join(':');
export function parseHours(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    if (typeof value === 'string' && !value.trim())
        return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}
export function formatHours(value) {
    // 不把尚未达到目标的 7.999h 显示成 8h。
    return String(Math.floor((value + EPSILON) * 100) / 100);
}
export function calculateHours(input) {
    const { snapshot, members, settings, range, today } = input;
    const dates = eachDateKey(range);
    const records = [...new Map(snapshot.records.map(record => [record.projectId + ':' + record.id, record])).values()].filter(record => record.spentDate <= today);
    const totals = new Map();
    const personal = new Map();
    const recordsByMember = new Map();
    for (const record of records) {
        const ownRecords = recordsByMember.get(record.staffId) ?? [];
        ownRecords.push(record);
        recordsByMember.set(record.staffId, ownRecords);
        const key = [record.projectId, record.entityType, record.entityId].join(':');
        totals.set(key, (totals.get(key) ?? 0) + record.hours);
        personal.set(key + ':' + record.staffId, (personal.get(key + ':' + record.staffId) ?? 0) + record.hours);
    }
    const tasks = [...new Map(snapshot.tasks.map(task => [hoursTaskKey(task), task])).values()];
    const tasksByMember = new Map();
    const remainingByTask = new Map();
    const taskIssues = new Set(snapshot.issues.filter(issue => issue.taskKey && issue.affects !== 'actual').map(issue => issue.taskKey));
    for (const task of tasks) {
        if (isHoursCompleted(task, settings))
            continue;
        const key = hoursTaskKey(task), estimate = (parseHours(task.effort) ?? (input.policy === 'mcp' && (task.effort === undefined || !String(task.effort).trim()) ? 0 : null));
        const remaining = estimate === null ? null : Math.max(estimate - (totals.get(key) ?? 0), 0);
        const share = estimate === null ? 0 : estimate / task.assigneeIds.length;
        const deficits = task.assigneeIds.map(id => Math.max(share - (personal.get(key + ':' + id) ?? 0), 0));
        const sum = deficits.reduce((a, b) => a + b, 0);
        remainingByTask.set(key, new Map(task.assigneeIds.map((id, index) => [id, remaining === null ? null : sum > EPSILON ? remaining * deficits[index] / sum : 0])));
        for (const id of task.assigneeIds) {
            const owned = tasksByMember.get(id) ?? [];
            owned.push(task);
            tasksByMember.set(id, owned);
        }
    }
    const exemptions = new Map(settings.exemptions.map(item => [item.staffId + ':' + item.date, item.hours]));
    const weekdays = new Map();
    return members.map(member => {
        const dayMap = new Map();
        const contributionMaps = new Map();
        const targetCache = new Map();
        const eligibleCache = new Map();
        const workingFor = (date) => {
            let working = weekdays.get(date);
            if (working === undefined) {
                working = isWorkingDay(date, input.calendar);
                weekdays.set(date, working);
            }
            return working;
        };
        const overtimeDates = new Set();
        const targetFor = (date) => {
            let target = targetCache.get(date);
            if (target === undefined) {
                target = workingFor(date) ? Math.max(settings.dailyRequiredHours - (exemptions.get(member.staffId + ':' + date) ?? 0), 0) : 0;
                targetCache.set(date, target);
            }
            return target;
        };
        function getDay(date) {
            let day = dayMap.get(date);
            if (!day) {
                day = { date, leaveHours: exemptions.get(member.staffId + ':' + date) ?? 0, actual: 0, allocated: 0, total: 0, target: targetFor(date), deficit: 0, basis: date < today ? 'actual' : 'forecast', state: 'enough', contributions: [], reasons: [] };
                dayMap.set(date, day);
            }
            return day;
        }
        function contribute(date, key, projectId, actual, allocated, explanation) {
            const day = getDay(date);
            if (date < range.start || date > range.end) {
                day.actual += actual;
                day.allocated += allocated;
                return;
            }
            let contributions = contributionMaps.get(date);
            if (!contributions) {
                contributions = new Map();
                contributionMaps.set(date, contributions);
            }
            let contribution = contributions.get(key);
            if (!contribution) {
                contribution = { taskKey: key, projectId, actual: 0, allocated: 0, explanation };
                day.contributions.push(contribution);
                contributions.set(key, contribution);
            }
            contribution.actual += actual;
            contribution.allocated += allocated;
            if (allocated > 0)
                contribution.explanation = explanation;
            day.actual += actual;
            day.allocated += allocated;
        }
        for (const record of recordsByMember.get(member.staffId) ?? []) {
            contribute(record.spentDate, [record.projectId, record.entityType, record.entityId].join(':'), record.projectId, record.hours, 0, '按花费日期和填报人统计实际工时');
        }
        const pending = [];
        const allocations = [];
        const unknownTasks = [];
        const taskOvertimeDates = new Map();
        for (const task of tasksByMember.get(member.staffId) ?? []) {
            const key = hoursTaskKey(task);
            // 截止日在非工作日时，末尾连续的休息日可承接工作日余量；中间周末不自动加班。
            const validInterval = !!task.startDate && !!task.dueDate && isValidDateKey(task.startDate) && isValidDateKey(task.dueDate) && task.startDate <= task.dueDate && dateDiffInDays(task.startDate, task.dueDate) <= 366;
            const taskDates = validInterval ? eachDateKey({ start: task.startDate, end: task.dueDate }) : [];
            const trailingRestDates = [];
            for (let index = taskDates.length - 1; index >= 0 && !workingFor(taskDates[index]); index--)
                trailingRestDates.unshift(taskDates[index]);
            const overtimeEligible = trailingRestDates.filter(date => date >= today && !exemptions.has(member.staffId + ':' + date));
            taskOvertimeDates.set(key, new Set(overtimeEligible));
            for (const date of overtimeEligible)
                overtimeDates.add(date);
            if (taskIssues.has(key)) {
                const overdue = !!task.dueDate && task.dueDate < today;
                pending.push({ task, hours: null, reason: '累计花费或负责人不完整，剩余量待确认', overdue });
                if (!overdue)
                    unknownTasks.push(task);
                continue;
            }
            const estimate = parseHours(task.effort);
            const ownRemaining = remainingByTask.get(key).get(member.staffId);
            if (ownRemaining !== null && ownRemaining <= EPSILON)
                continue;
            const overdue = !!task.dueDate && task.dueDate < today;
            let reason = '';
            if (estimate === null)
                reason = '缺少有效预估工时';
            else if (!task.startDate || !task.dueDate || !isValidDateKey(task.startDate) || !isValidDateKey(task.dueDate))
                reason = '缺少有效排期日期';
            else if (task.startDate > task.dueDate)
                reason = '开始日期晚于截止日期';
            else if (overdue)
                reason = '已逾期，调整 TAPD 排期后参与分配';
            const start = task.startDate && task.startDate > today ? task.startDate : today;
            if (!reason && task.dueDate && dateDiffInDays(start, task.dueDate) > 366)
                reason = '排期超过 366 天安全范围';
            let eligible = [];
            if (!reason && task.dueDate) {
                const interval = start + ':' + task.dueDate;
                eligible = eligibleCache.get(interval) ?? eachDateKey({ start, end: task.dueDate }).filter(date => targetFor(date) > 0);
                eligibleCache.set(interval, eligible);
            }
            if (!reason && eligible.length === 0 && overtimeEligible.length === 0)
                reason = '排期内没有可分配日期';
            if (reason) {
                pending.push({ task, hours: ownRemaining, reason, overdue });
                if (!overdue)
                    unknownTasks.push(task);
                continue;
            }
            const explanation = task.assigneeIds.length > 1 ? '按负责人均分份额扣减本人花费，再按剩余份额比例分配任务总剩余量' : '预估减截至今天累计花费；按截止日期优先补齐每日规定工时';
            allocations.push({ task, key, remaining: ownRemaining, dates: eligible, overtimeDates: overtimeEligible, explanation });
        }
        const ordered = allocations.sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate) || a.task.startDate.localeCompare(b.task.startDate) || a.key.localeCompare(b.key));
        // 先预留只剩一个有效工作日的任务，跨日任务不得挤占这部分容量。
        for (const item of ordered.filter(item => item.dates.length === 1 && item.overtimeDates.length === 0)) {
            contribute(item.dates[0], item.key, item.task.projectId, 0, item.remaining, item.explanation);
            item.remaining = 0;
        }
        const active = ordered.filter(item => item.remaining > EPSILON && item.dates.length > 0);
        const allocationDates = [...new Set(active.flatMap(item => item.dates))].sort();
        for (const date of allocationDates) {
            const day = getDay(date);
            let available = Math.max(day.target - day.actual - day.allocated, 0);
            for (let index = 0; index < active.length;) {
                const item = active[index];
                const last = item.dates[item.dates.length - 1];
                if (item.dates[0] > date || last < date || targetFor(date) === 0) {
                    index++;
                    continue;
                }
                const amount = date === last && item.overtimeDates.length === 0 ? item.remaining : Math.min(item.remaining, available);
                if (amount > EPSILON) {
                    contribute(date, item.key, item.task.projectId, 0, amount, item.explanation);
                    item.remaining = Math.max(item.remaining - amount, 0);
                    available = Math.max(available - amount, 0);
                }
                if (item.remaining <= EPSILON)
                    active.splice(index, 1);
                else
                    index++;
            }
        }
        // 工作日分配结束后，将余量均分至截止前末尾连续的非工作日，无每日容量上限。
        for (const item of ordered) {
            if (item.remaining <= EPSILON || item.overtimeDates.length === 0)
                continue;
            const amountPerDate = item.remaining / item.overtimeDates.length;
            for (let index = 0; index < item.overtimeDates.length; index++) {
                const amount = index === item.overtimeDates.length - 1 ? item.remaining - amountPerDate * index : amountPerDate;
                contribute(item.overtimeDates[index], item.key, item.task.projectId, 0, amount, item.explanation + '；截止日在非工作日，工作日分配后余量按末尾可安排的非工作日均分，不受每日规定工时限制');
            }
            item.remaining = 0;
        }
        const pendingReasons = new Map(pending.map(item => [hoursTaskKey(item.task), item.reason]));
        const days = dates.map(date => {
            const day = getDay(date);
            day.total = day.actual + (day.basis === 'forecast' ? day.allocated : 0);
            day.deficit = Math.max(day.target - day.total, 0);
            day.reasons = snapshot.issues.filter(issue => (!issue.staffId || issue.staffId === member.staffId) && (!issue.date || issue.date === date) && !issue.taskKey && ((issue.affects === 'actual' || issue.affects === 'both') && date <= today || (issue.affects === 'forecast' || issue.affects === 'both') && date >= today && (day.target > 0 || overtimeDates.has(date)))).map(issue => ({ projectId: issue.projectId, message: issue.message }));
            if (date >= today && (day.target > 0 || overtimeDates.has(date))) {
                for (const task of unknownTasks) {
                    if (day.target === 0 && !taskOvertimeDates.get(hoursTaskKey(task))?.has(date))
                        continue;
                    // 无有效完整区间的任务仅列入待安排，不能推断其影响所有未来日期。
                    if (task.startDate && task.dueDate && isValidDateKey(task.startDate) && isValidDateKey(task.dueDate) && task.startDate <= task.dueDate && task.startDate <= date && task.dueDate >= date) {
                        const reason = pendingReasons.get(hoursTaskKey(task));
                        day.reasons.push({ projectId: task.projectId, message: '任务「' + task.title + '」：' + (reason || '无法完整计算剩余排期') });
                    }
                }
            }
            day.reasons = [...new Map(day.reasons.map(reason => [JSON.stringify([reason.projectId, reason.message]), reason])).values()];
            // 已知工时达到目标时保留工时结论；完整性由 reasons 独立表达。
            day.state = day.target === 0 ? 'exempt' : day.total + EPSILON < day.target ? (day.reasons.length ? 'unknown' : 'short') : day.basis === 'forecast' && day.total > day.target + EPSILON ? 'over' : 'enough';
            return day;
        });
        return { member, days, pending, historicalShortDays: days.filter(day => day.state === 'short' && day.basis === 'actual').length, forecastShortDays: days.filter(day => day.state === 'short' && day.basis === 'forecast').length };
    });
}
