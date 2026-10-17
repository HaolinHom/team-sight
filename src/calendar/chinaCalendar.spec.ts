import { describe, expect, it } from 'vitest';
import { calendarTaskRanges, calendarYearsForRanges, isWorkingDay, mergeCalendar, normalizeChinaCalendar, parseHolidayYear } from './chinaCalendar';
import { normalizeSettings } from '@/types/settings';
import { dailyTarget, createHoursSettings } from '@/hours/settings';
import type { ScheduleTask } from '@/types/schedule';

const raw = { year: 2026, papers: ['https://www.gov.cn/example'], days: [
  { date: '2026-10-01', name: '国庆节', isOffDay: true },
  { date: '2026-10-10', name: '国庆节', isOffDay: false },
] };
const cache = { ...parseHolidayYear(raw, 2026), fetchedAt: '2000-01-01T00:00:00Z' };
describe('中国日历及配置迁移', () => {
  it('线上休假覆盖周中，补班覆盖周末，其他日期保持周历，个人请假优先', () => {
    const calendar = mergeCalendar({ enabled: true, years: { 2026: cache } });
    expect(isWorkingDay('2026-10-01', calendar)).toBe(false);
    expect(isWorkingDay('2026-10-10', calendar)).toBe(true);
    expect(isWorkingDay('2026-10-11', calendar)).toBe(false);
    expect(isWorkingDay('2026-10-12', calendar)).toBe(true);
    expect(dailyTarget('2026-10-10', '100', createHoursSettings(), calendar)).toBe(8);
    expect(dailyTarget('2026-10-10', '100', { ...createHoursSettings(), exemptions: [{ staffId: '100', date: '2026-10-10', note: '' }] }, calendar)).toBe(0);
    expect(isWorkingDay('2026-10-10', mergeCalendar({ enabled: false, years: { 2026: cache } }))).toBe(false);
  });
  it('缓存没有有效期，v2手动覆盖丢弃，其他工时配置保留', () => {
    const { settings } = normalizeSettings({ schemaVersion: 2, hours: { dailyRequiredHours: 7.5, calendarOverrides: [{ date: '2026-10-12', working: false }], exemptions: [{ staffId: '100', date: '2026-10-10' }] }, chinaCalendar: { enabled: true, years: { 2026: cache } } }, new Date('2090-01-01'));
    expect(settings.schemaVersion).toBe(3); expect(settings.chinaCalendar.years[2026]).toEqual(cache);
    expect(settings.hours).not.toHaveProperty('calendarOverrides'); expect(settings.hours.dailyRequiredHours).toBe(7.5); expect(settings.hours.exemptions).toHaveLength(1);
  });
  it('损坏缓存按年份隔离，不改变开关，缺失开关默认为关闭', () => {
    const settings = normalizeChinaCalendar({ enabled: true, years: { 2026: cache, 2025: { ...cache, year: 2025, fetchedAt: 'broken' }, 2027: null } });
    expect(settings.enabled).toBe(true); expect(Object.keys(settings.years)).toEqual(['2026']);
    expect(normalizeChinaCalendar(null)).toEqual({ enabled: false, years: {} });
  });
  it.each([
    { ...raw, year: 2025 }, { ...raw, days: [] }, { ...raw, papers: [] },
    { ...raw, days: [{ ...raw.days[0], date: '2026-02-30' }] },
    { ...raw, days: [{ ...raw.days[0], isOffDay: 'false' }] },
    { ...raw, days: [raw.days[0], raw.days[0]] },
  ])('拒绝不完整或无效线上数据 %#', value => expect(() => parseHolidayYear(value, 2026)).toThrow());
  it('按实际日期合并，次年文件可覆盖上一年12月', () => {
    const next = { ...parseHolidayYear({ ...raw, year: 2027, days: [{ date: '2026-12-31', name: '元旦', isOffDay: true }] }, 2027), fetchedAt: cache.fetchedAt };
    const days = mergeCalendar({ enabled: true, years: { 2027: next, 2026: { ...cache, days: { ...cache.days, '2026-12-31': { working: true, name: '旧安排' } } } } });
    expect(days['2026-12-31']).toEqual({ working: false, name: '元旦' });
  });
  it('按完整任务区间补齐跨年文件，12月需要下一年补充，非法超长区间不扩散', () => {
    const tasks = [{ startDate: '2026-12-30', dueDate: '2027-01-05' }, { startDate: null, dueDate: '2090-01-01' }, { startDate: '2027-02-01', dueDate: '2026-01-01' }] as ScheduleTask[];
    const ranges = calendarTaskRanges(tasks, '2026-12-30');
    expect(calendarYearsForRanges([{ start: '2026-12-30', end: '2026-12-30' }, ...ranges])).toEqual({ required: [2026, 2027], sources: [2026, 2027] });
    expect(calendarYearsForRanges([{ start: '2026-12-01', end: '2026-12-10' }])).toEqual({ required: [2026], sources: [2026, 2027] });
    expect(calendarTaskRanges([{ startDate: '2020-01-01', dueDate: '2090-01-01' }] as ScheduleTask[], '2026-01-01')).toEqual([]);
  });
});
