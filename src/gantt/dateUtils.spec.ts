import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareDateKeys,
  currentMonthRange,
  dateDiffInDays,
  eachDateKey,
  isWeekend,
  isValidDateKey,
  maxDateKey,
  minDateKey,
  todayKey,
} from './dateUtils';

describe('isValidDateKey', () => {
  it('接受标准 YYYY-MM-DD', () => {
    expect(isValidDateKey('2026-10-01')).toBe(true);
  });

  it('拒绝不存在的日期与非标准格式', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-2-1')).toBe(false);
    expect(isValidDateKey('2026-10-01 10:00:00')).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
  });
});

describe('天数计算', () => {
  it('跨月天数差不偏移', () => {
    expect(dateDiffInDays('2026-03-01', '2026-03-31')).toBe(30);
    expect(dateDiffInDays('2026-09-25', '2026-10-06')).toBe(11);
  });

  it('addDays 支持跨月与跨年', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('currentMonthRange', () => {
  it('返回自然月首尾', () => {
    expect(currentMonthRange(new Date(2026, 9, 9))).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });

  it('闰年 2 月为 29 天', () => {
    expect(currentMonthRange(new Date(2028, 1, 15))).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });
});

describe('eachDateKey', () => {
  it('覆盖闭区间每一天', () => {
    const days = eachDateKey({ start: '2026-10-01', end: '2026-10-05' });
    expect(days).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
  });
});

describe('isWeekend', () => {
  it('识别周六周日', () => {
    expect(isWeekend('2026-10-03')).toBe(true);
    expect(isWeekend('2026-10-04')).toBe(true);
    expect(isWeekend('2026-10-05')).toBe(false);
  });
});

describe('边界比较', () => {
  it('compareDateKeys 将 null 视为最大', () => {
    expect(compareDateKeys('2026-10-01', '2026-10-02')).toBe(-1);
    expect(compareDateKeys('2026-10-02', '2026-10-02')).toBe(0);
    expect(compareDateKeys(null, '2026-10-02')).toBe(1);
    expect(compareDateKeys('2026-10-02', null)).toBe(-1);
  });

  it('max/min 取窗口裁剪边界', () => {
    expect(maxDateKey('2026-09-25', '2026-10-01')).toBe('2026-10-01');
    expect(minDateKey('2026-10-25', '2026-10-31')).toBe('2026-10-25');
  });

  it('todayKey 使用本地日期', () => {
    expect(todayKey(new Date(2026, 9, 9, 23, 30))).toBe('2026-10-09');
  });
});
