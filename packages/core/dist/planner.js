import { eachDateKey, isValidDateKey, dateDiffInDays, assertRange } from './date.js';
const EPS = 1e-8;
export function planSchedule(input) {
    assertRange(input.range);
    const dates = eachDateKey(input.range);
    if (!isValidDateKey(input.range.start) || !isValidDateKey(input.range.end) || dates.length > 366 || !dates.length)
        throw new RangeError('INVALID_RANGE');
    const budget = Math.min(50000, Math.max(1, input.maxStates ?? 50000));
    const result = { status: 'search_incomplete', candidates: [], conflicts: [], unscheduled: input.tasks.map(task => task.ref), search: { visited: 0, budget, complete: false }, assumptions: ['仅使用日期粒度；同日交接必须显式允许。', '每日分配是本次计算结果，后续按最新TAPD数据重新计算。'] };
    const fail = (status, message) => { result.status = status; result.conflicts.push(message); result.search.complete = status === 'infeasible'; return result; };
    const tasks = input.tasks;
    if (!tasks.length || new Set(tasks.map(task => task.ref)).size !== tasks.length || tasks.some(task => !task.ref || !Number.isFinite(task.hours) || task.hours < 0 || !task.memberIds.length))
        return fail('needs_information', '任务身份、工时或候选负责人无效');
    if (tasks.some(task => task.memberIds.some(id => !input.capacities[id])))
        return fail('needs_information', '候选成员容量缺失');
    if (Object.values(input.capacities).some(days => days.some(day => day.unknown)))
        return fail('needs_information', '容量来源不完整，不能给出确定可行性');
    const deps = input.dependencies ?? [], milestones = new Map((input.milestones ?? []).map(node => [node.ref, node.date]));
    const refs = new Set([...tasks.map(task => task.ref), ...milestones.keys()]);
    if (deps.some(edge => !refs.has(edge.before) || !refs.has(edge.after)))
        return fail('needs_information', '依赖对象缺失，请提供任务或交付节点');
    const ordered = [], todo = [...tasks].sort((a, b) => (a.latest ?? input.range.end).localeCompare(b.latest ?? input.range.end) || a.ref.localeCompare(b.ref));
    while (todo.length) {
        const index = todo.findIndex(task => !deps.some(edge => edge.after === task.ref && todo.some(other => other.ref === edge.before)));
        if (index < 0)
            return fail('infeasible', '任务依赖存在环');
        ordered.push(todo.splice(index, 1)[0]);
    }
    const base = new Map();
    const targets = new Map();
    for (const [member, days] of Object.entries(input.capacities))
        for (const day of days) {
            const key = member + ':' + day.date;
            base.set(key, Math.max(0, day.available));
            targets.set(key, day.target);
        }
    for (const task of tasks) {
        const maximum = Math.max(0, ...task.memberIds.map(member => dates.filter(date => (!task.earliest || date >= task.earliest) && (!task.latest || date <= task.latest)).reduce((sum, date) => sum + (base.get(member + ':' + date) ?? 0), 0)));
        if (maximum + EPS < task.hours)
            return fail('infeasible', '任务 ' + task.ref + ' 在窗口内的单人总容量不足');
    }
    const solutions = [];
    let stopped = false;
    let activeProfile = 'continuity', solutionStart = 0, passLimit = Math.ceil(budget / 2);
    function boundaryValid(edge, before, after) {
        const finish = before?.end ?? milestones.get(edge.before), start = after?.start ?? milestones.get(edge.after);
        return !finish || !start || (edge.allowSameDay ? finish <= start : finish < start);
    }
    function choices(task, used, placed) {
        const output = [], seen = new Set();
        for (const memberId of [...new Set(task.memberIds)].sort()) {
            const eligible = dates.filter(date => (!task.earliest || date >= task.earliest) && (!task.latest || date <= task.latest) && (targets.get(memberId + ':' + date) ?? 0) > 0);
            const add = (daily) => {
                if (!daily.length)
                    return;
                daily.sort((a, b) => a.date.localeCompare(b.date));
                const value = { ref: task.ref, memberId, start: daily[0].date, end: daily.at(-1).date, daily };
                if (deps.some(edge => !boundaryValid(edge, edge.before === task.ref ? value : placed.find(p => p.ref === edge.before), edge.after === task.ref ? value : placed.find(p => p.ref === edge.after))))
                    return;
                const key = JSON.stringify([memberId, daily]);
                if (!seen.has(key)) {
                    seen.add(key);
                    output.push(value);
                }
            };
            if (task.hours <= EPS) {
                for (const date of eligible)
                    add([{ date, hours: 0 }]);
                continue;
            }
            // Forward/backward greedy fills for every possible start preserve fractional hours without time-slot rounding.
            for (const reverse of [false, true]) {
                const scan = reverse ? [...eligible].reverse() : eligible;
                for (let start = 0; start < scan.length; start++) {
                    const daily = [];
                    let remaining = task.hours;
                    for (let index = start; index < scan.length && remaining > EPS; index++) {
                        const date = scan[index], key = memberId + ':' + date, free = Math.max(0, (base.get(key) ?? 0) - (used.get(key) ?? 0));
                        const hours = Math.min(free, remaining);
                        if (hours > EPS) {
                            daily.push({ date, hours });
                            remaining -= hours;
                        }
                    }
                    if (remaining <= EPS)
                        add(daily);
                }
            }
        }
        return output.sort((a, b) => {
            const timing = input.direction === 'backward' ? b.start.localeCompare(a.start) || b.end.localeCompare(a.end) : a.end.localeCompare(b.end) || a.start.localeCompare(b.start);
            if (activeProfile === 'earliest')
                return timing || a.memberId.localeCompare(b.memberId);
            const am = metrics([a]), bm = metrics([b]);
            return am.interruptions - bm.interruptions || am.splitDays - bm.splitDays || timing || a.memberId.localeCompare(b.memberId);
        });
    }
    function visit(index, placed, used) {
        if (result.search.visited >= passLimit || solutions.length - solutionStart >= 200) {
            stopped = true;
            return;
        }
        result.search.visited++;
        if (index === ordered.length) {
            solutions.push(placed);
            return;
        }
        for (const placement of choices(ordered[index], used, placed)) {
            const next = new Map(used);
            for (const day of placement.daily) {
                const key = placement.memberId + ':' + day.date;
                next.set(key, (next.get(key) ?? 0) + day.hours);
            }
            visit(index + 1, [...placed, placement], next);
            if (stopped)
                return;
        }
    }
    visit(0, [], new Map());
    activeProfile = 'earliest';
    solutionStart = solutions.length;
    passLimit = budget;
    stopped = false;
    visit(0, [], new Map());
    function metrics(placements) {
        let interruptions = 0, splitDays = 0;
        const spans = new Map();
        for (const placement of placements) {
            splitDays += Math.max(0, placement.daily.length - 1);
            const businessDates = dates.filter(date => (targets.get(placement.memberId + ':' + date) ?? 0) > 0);
            for (let i = 1; i < placement.daily.length; i++)
                if (businessDates.indexOf(placement.daily[i].date) - businessDates.indexOf(placement.daily[i - 1].date) > 1)
                    interruptions++;
            const task = tasks.find(task => task.ref === placement.ref), key = (task.projectId ?? '') + ':' + (task.storyId ?? task.ref);
            spans.set(key, [...(spans.get(key) ?? []), placement.start, placement.end]);
        }
        return { interruptions, splitDays, completion: placements.map(p => p.end).sort().at(-1), start: placements.map(p => p.start).sort()[0], requirementSpan: [...spans.values()].reduce((sum, values) => { values.sort(); return sum + dateDiffInDays(values[0], values.at(-1)); }, 0) };
    }
    const candidates = solutions.map(placements => ({ placements, metrics: metrics(placements) }));
    for (const profile of ['continuity', 'earliest']) {
        const sorted = [...candidates].sort((a, b) => {
            const timing = input.direction === 'backward' ? b.metrics.start.localeCompare(a.metrics.start) : a.metrics.completion.localeCompare(b.metrics.completion);
            return profile === 'continuity' ? a.metrics.interruptions - b.metrics.interruptions || a.metrics.splitDays - b.metrics.splitDays || timing || a.metrics.requirementSpan - b.metrics.requirementSpan : timing || a.metrics.interruptions - b.metrics.interruptions || a.metrics.splitDays - b.metrics.splitDays || a.metrics.requirementSpan - b.metrics.requirementSpan;
        });
        if (sorted[0])
            result.candidates.push({ id: profile, profile, ...sorted[0] });
    }
    // Interval-fill enumeration is deliberately bounded, not an exhaustive continuous-workload proof.
    result.search.complete = false;
    result.status = result.candidates.length ? 'feasible' : 'search_incomplete';
    result.unscheduled = result.candidates.length ? [] : tasks.map(task => task.ref);
    if (!result.candidates.length)
        result.conflicts.push(stopped ? '搜索预算耗尽，尚未找到可行候选' : '当前候选枚举未找到安排，不能据此证明无解');
    return result;
}
