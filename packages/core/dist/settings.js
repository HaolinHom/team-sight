import { isValidDateKey } from './date.js';
export const SETTINGS_SCHEMA_VERSION = 4;
export const DEFAULT_TAPD_BASE_URL = 'https://api.tapd.cn';
const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#6366f1', '#ec4899'];
export function createDefaultSettings(now = new Date()) {
    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        teamName: 'TeamSight',
        timeZone: 'Asia/Shanghai',
        projects: [],
        members: [],
        hours: { dailyRequiredHours: 8, exemptions: [], completedStates: [] },
        chinaCalendar: { enabled: false, years: {} },
        tapd: { baseUrl: DEFAULT_TAPD_BASE_URL, workspaceIds: [], defaultTypes: ['task', 'bug'] },
        updatedAt: now.toISOString(),
    };
}
function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function workType(value) { return value === 'task' || value === 'bug'; }
function normalizeHours(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    const daily = Number(record.dailyRequiredHours);
    const exemptions = Array.isArray(record.exemptions) ? record.exemptions.flatMap(item => {
        if (!item || typeof item !== 'object')
            return [];
        const value = item;
        const hours = Number(value.hours);
        const staffId = text(value.staffId);
        const date = text(value.date);
        return staffId && isValidDateKey(date) && Number.isFinite(hours) && hours > 0 ? [{ staffId, date, hours, note: text(value.note) }] : [];
    }) : [];
    const completedStates = Array.isArray(record.completedStates) ? record.completedStates.flatMap(item => {
        if (!item || typeof item !== 'object')
            return [];
        const value = item;
        const projectId = text(value.projectId);
        const type = value.type;
        const values = Array.isArray(value.values) ? value.values.map(text).filter(Boolean) : [];
        return projectId && workType(type) ? [{ projectId, type, values }] : [];
    }) : [];
    return { dailyRequiredHours: Number.isFinite(daily) && daily >= 0 && daily <= 24 ? daily : 8, exemptions, completedStates };
}
function normalizeCalendar(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    const years = {};
    if (record.years && typeof record.years === 'object') {
        for (const [key, rawYear] of Object.entries(record.years)) {
            if (!rawYear || typeof rawYear !== 'object')
                continue;
            const year = rawYear;
            const days = year.days && typeof year.days === 'object' ? year.days : {};
            const normalizedDays = {};
            for (const [date, rawDay] of Object.entries(days)) {
                if (!isValidDateKey(date) || !rawDay || typeof rawDay !== 'object')
                    continue;
                const day = rawDay;
                if (typeof day.working === 'boolean' && text(day.name))
                    normalizedDays[date] = { working: day.working, name: text(day.name) };
            }
            const numericYear = Number(year.year ?? key);
            if (Number.isInteger(numericYear) && Object.keys(normalizedDays).length > 0) {
                years[key] = { year: numericYear, days: normalizedDays, papers: Array.isArray(year.papers) ? year.papers.map(text).filter(Boolean) : [], fetchedAt: text(year.fetchedAt) };
            }
        }
    }
    return { enabled: record.enabled === true, years };
}
export function normalizeSettings(raw, now = new Date()) {
    const defaults = createDefaultSettings(now);
    if (!raw || typeof raw !== 'object')
        return { settings: defaults, warning: '未找到配置，已使用默认配置' };
    const record = raw;
    const projects = [];
    const used = new Set();
    if (Array.isArray(record.projects))
        for (const item of record.projects) {
            if (!item || typeof item !== 'object')
                continue;
            const value = item;
            const id = text(value.id);
            if (!id)
                continue;
            const color = text(value.color) || colors.find(candidate => !used.has(candidate)) || colors[projects.length % colors.length];
            used.add(color);
            projects.push({ id, name: text(value.name) || `项目 ${id}`, enabled: value.enabled === true, color });
        }
    const members = [];
    const seenMembers = new Set();
    if (Array.isArray(record.members))
        for (const item of record.members) {
            if (!item || typeof item !== 'object')
                continue;
            const value = item;
            const staffId = text(value.staffId);
            if (!staffId || seenMembers.has(staffId))
                continue;
            seenMembers.add(staffId);
            members.push({ staffId, name: text(value.name) || staffId });
        }
    const tapdRaw = record.tapd && typeof record.tapd === 'object' ? record.tapd : {};
    const workspaceIds = Array.isArray(tapdRaw.workspaceIds) ? tapdRaw.workspaceIds.map(text).filter(Boolean) : [];
    const defaultTypes = Array.isArray(tapdRaw.defaultTypes)
        ? tapdRaw.defaultTypes.filter((item) => workType(item))
        : ['task', 'bug'];
    const access = tapdRaw.writeAccess && typeof tapdRaw.writeAccess === 'object' ? tapdRaw.writeAccess : {};
    const writeAccess = {
        workspaceIds: Array.isArray(access.workspaceIds) ? access.workspaceIds.map(text).filter(Boolean) : [],
        operations: Array.isArray(access.operations) ? access.operations.filter((v) => v === 'create' || v === 'update') : [],
        fields: Array.isArray(access.fields) ? access.fields.map(text).filter(Boolean) : [],
    };
    const version = Number(record.schemaVersion);
    const warning = Number.isFinite(version) && version !== SETTINGS_SCHEMA_VERSION ? `配置版本为 ${version}，已按当前版本读取` : undefined;
    return {
        settings: {
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            teamName: text(record.teamName) || defaults.teamName,
            timeZone: record.timeZone === 'UTC' ? 'UTC' : 'Asia/Shanghai',
            projects,
            members,
            hours: normalizeHours(record.hours),
            chinaCalendar: normalizeCalendar(record.chinaCalendar),
            tapd: { baseUrl: text(tapdRaw.baseUrl) || DEFAULT_TAPD_BASE_URL, workspaceIds, defaultTypes, writeAccess },
            updatedAt: text(record.updatedAt) || now.toISOString(),
        },
        warning,
    };
}
/** 读取旧 App 的 settings.json，只迁移业务配置；凭据字段永不进入 SQLite。 */
export function importLegacySettings(raw, now = new Date()) {
    const normalized = normalizeSettings(raw, now);
    const serialized = JSON.stringify(raw);
    const ignoredCredential = /personalToken|tapdToken|token|password|credential/i.test(serialized);
    return { ...normalized, ignoredCredential };
}
