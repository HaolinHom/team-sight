import { isValidDateKey, isWeekend } from '@/gantt/dateUtils';
import type { ScheduleTask } from '@/types/schedule';
import type { HoursSettings } from '@/types/hours';

export const DEFAULT_COMPLETED_STATES = ['done', 'closed', 'resolved', 'rejected'];
export function createHoursSettings(): HoursSettings {
  return { dailyRequiredHours: 8, calendarOverrides: [], exemptions: [], completedStates: [] };
}

export function normalizeHoursSettings(raw: unknown): HoursSettings {
  const defaults = createHoursSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const value = raw as Partial<HoursSettings>;
  const number = typeof value.dailyRequiredHours === 'number' || typeof value.dailyRequiredHours === 'string' ? Number(value.dailyRequiredHours) : NaN;
  return {
    dailyRequiredHours: Number.isFinite(number) && number > 0 ? number : 8,
    calendarOverrides: Array.isArray(value.calendarOverrides) ? value.calendarOverrides.filter(item => item && isValidDateKey(item.date) && typeof item.working === 'boolean').map(item => ({ date: item.date, working: item.working, note: String(item.note ?? '') })) : [],
    exemptions: Array.isArray(value.exemptions) ? value.exemptions.filter(item => item && typeof item.staffId === 'string' && item.staffId && isValidDateKey(item.date)).map(item => ({ staffId: item.staffId, date: item.date, note: String(item.note ?? '') })) : [],
    completedStates: Array.isArray(value.completedStates) ? value.completedStates.filter(item => item && typeof item.projectId === 'string' && item.projectId && ['task', 'bug'].includes(item.type) && Array.isArray(item.values)).map(item => ({ projectId: item.projectId, type: item.type, values: item.values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) })) : [],
  };
}

export function validateHoursSettings(value: HoursSettings): string {
  if (!Number.isFinite(value.dailyRequiredHours) || value.dailyRequiredHours <= 0) return '每日规定工时必须为大于 0 的有效小时数';
  if (value.calendarOverrides.some(item => !isValidDateKey(item.date))) return '节假日／调休日期无效';
  if (value.exemptions.some(item => !item.staffId || !isValidDateKey(item.date))) return '请假豁免需要成员和有效日期';
  if (value.completedStates.some(item => !item.projectId || !['task', 'bug'].includes(item.type) || !item.values.length || item.values.some(v => !v.trim()))) return '结束状态需要项目、类型及至少一个状态';
  return '';
}

export function isHoursCompleted(task: ScheduleTask, settings: HoursSettings): boolean {
  const extra = settings.completedStates.filter(item => item.projectId === task.projectId && item.type === task.sourceType).flatMap(item => item.values);
  return [...DEFAULT_COMPLETED_STATES, ...extra].some(value => value.toLowerCase() === task.status.trim().toLowerCase());
}

export function dailyTarget(date: string, staffId: string, settings: HoursSettings): number {
  const override = settings.calendarOverrides.filter(item => item.date === date).at(-1);
  const working = override ? override.working : !isWeekend(date);
  return working && !settings.exemptions.some(item => item.date === date && item.staffId === staffId) ? settings.dailyRequiredHours : 0;
}

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
