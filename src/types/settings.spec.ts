import { describe, expect, it } from 'vitest';
import { createHoursSettings } from '@/hours/settings';

import {
  PROJECT_PALETTE,
  SETTINGS_SCHEMA_VERSION,
  createEmptySettings,
  mergeMembers,
  normalizeSettings,
  pickProjectColor,
} from './settings';

describe('createEmptySettings', () => {
  it('返回空项目与空成员的默认配置', () => {
    const settings = createEmptySettings(new Date('2026-10-10T00:00:00Z'));
    expect(settings).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      projects: [],
      members: [],
      hours: createHoursSettings(),
      chinaCalendar: { enabled: false, years: {} },
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
  });
});

describe('pickProjectColor', () => {
  it('优先返回未被占用的颜色', () => {
    const color = pickProjectColor([PROJECT_PALETTE[0]], () => 0);
    expect(color).toBe(PROJECT_PALETTE[1]);
  });

  it('颜色用尽时按随机下标复用', () => {
    const color = pickProjectColor(PROJECT_PALETTE, () => 0.5);
    expect(PROJECT_PALETTE).toContain(color);
  });
});

describe('normalizeSettings', () => {
  it('空输入回退默认配置并给出提示', () => {
    const { settings, warning } = normalizeSettings(null);
    expect(settings.projects).toEqual([]);
    expect(warning).toContain('默认配置');
  });

  it('新增项目默认禁用，缺失颜色时自动分配', () => {
    const { settings } = normalizeSettings({
      schemaVersion: 1,
      projects: [{ id: '63253157', name: '巨像销售中台产品线' }],
      members: [],
    });

    expect(settings.projects[0]).toMatchObject({
      id: '63253157',
      name: '巨像销售中台产品线',
      enabled: false,
    });
    expect(PROJECT_PALETTE).toContain(settings.projects[0].color);
  });

  it('按工号去重成员并忽略非法条目', () => {
    const { settings } = normalizeSettings({
      members: [
        { staffId: '800100001', name: '张三' },
        { staffId: '800100001', name: '张三（重复）' },
        { staffId: '', name: '无效' },
        { name: '缺工号' },
        { staffId: '800100002' },
      ],
    });

    expect(settings.members).toEqual([
      { staffId: '800100001', name: '张三' },
      { staffId: '800100002', name: '800100002' },
    ]);
  });

  it('版本不一致时提示但仍读取配置', () => {
    const { settings, warning } = normalizeSettings({ schemaVersion: 99, projects: [], members: [] });
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(warning).toContain('99');
  });

  it('损坏结构退化为空列表而不抛异常', () => {
    const { settings } = normalizeSettings({ projects: 'oops', members: 42 });
    expect(settings.projects).toEqual([]);
    expect(settings.members).toEqual([]);
  });
});

describe('mergeMembers', () => {
  it('按工号去重追加，保留原有顺序', () => {
    const merged = mergeMembers(
      [{ staffId: '1', name: '甲' }],
      [
        { staffId: '1', name: '甲（别名）' },
        { staffId: '2', name: '乙' },
      ]
    );
    expect(merged).toEqual([
      { staffId: '1', name: '甲' },
      { staffId: '2', name: '乙' },
    ]);
  });
});
