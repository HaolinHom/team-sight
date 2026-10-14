import type { ProjectConfig } from './schedule';
import type { HoursSettings } from './hours';
import { createHoursSettings, normalizeHoursSettings } from '@/hours/settings';

/** 配置 schema 版本，用于后续迁移判断。 */
export const SETTINGS_SCHEMA_VERSION = 2;

/** 展示成员：工号是稳定标识，姓名为展示名。 */
export interface MemberEntry {
  staffId: string;
  name: string;
}

export interface AppSettings {
  schemaVersion: number;
  projects: ProjectConfig[];
  members: MemberEntry[];
  hours: HoursSettings;
  updatedAt: string;
}

/** 项目颜色调色板：只表达项目归属，不表达优先级或风险。 */
export const PROJECT_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#6366f1',
  '#ec4899',
  '#0ea5e9',
  '#84cc16',
];

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function createEmptySettings(now: Date = new Date()): AppSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    projects: [],
    members: [],
    hours: createHoursSettings(),
    updatedAt: now.toISOString(),
  };
}

/** 从未占用的颜色里随机取一个；全部占用时按随机下标复用。 */
export function pickProjectColor(
  usedColors: readonly string[],
  random: () => number = Math.random
): string {
  const used = new Set(usedColors);
  const available = PROJECT_PALETTE.filter((color) => !used.has(color));
  if (available.length === 0) {
    return PROJECT_PALETTE[Math.floor(random() * PROJECT_PALETTE.length)];
  }
  return available[Math.floor(random() * available.length)];
}

function normalizeMember(raw: unknown): MemberEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const staffId = asString(record.staffId);
  const name = asString(record.name);
  if (!staffId) return null;
  return { staffId, name: name || staffId };
}

function normalizeProject(raw: unknown, usedColors: string[]): ProjectConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  if (!id) return null;
  const color = asString(record.color) || pickProjectColor(usedColors);
  usedColors.push(color);
  return {
    id,
    name: asString(record.name) || `项目 ${id}`,
    enabled: record.enabled === true,
    color,
  };
}

/**
 * 把磁盘/持久层里的任意内容规整为可用配置。
 * 结构损坏时回退默认值并给出可展示的提示，不抛异常打断应用启动。
 */
export function normalizeSettings(
  raw: unknown,
  now: Date = new Date()
): { settings: AppSettings; warning?: string } {
  if (!raw || typeof raw !== 'object') {
    return { settings: createEmptySettings(now), warning: '未找到本地配置，已使用默认配置' };
  }

  const record = raw as Record<string, unknown>;
  const usedColors: string[] = [];
  const projects = Array.isArray(record.projects)
    ? record.projects
        .map((item) => normalizeProject(item, usedColors))
        .filter((item): item is ProjectConfig => item !== null)
    : [];

  const seenStaffIds = new Set<string>();
  const members: MemberEntry[] = [];
  if (Array.isArray(record.members)) {
    for (const item of record.members) {
      const member = normalizeMember(item);
      if (!member || seenStaffIds.has(member.staffId)) continue;
      seenStaffIds.add(member.staffId);
      members.push(member);
    }
  }

  const schemaVersion = Number(record.schemaVersion);
  const warning =
    Number.isFinite(schemaVersion) && schemaVersion !== SETTINGS_SCHEMA_VERSION
      ? `配置版本为 ${schemaVersion}，已按当前版本 ${SETTINGS_SCHEMA_VERSION} 读取`
      : undefined;

  return {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      projects,
      members,
      hours: normalizeHoursSettings(record.hours),
      updatedAt: asString(record.updatedAt) || now.toISOString(),
    },
    warning,
  };
}

export function mergeMembers(
  existing: readonly MemberEntry[],
  incoming: readonly MemberEntry[]
): MemberEntry[] {
  const result = [...existing];
  const seen = new Set(existing.map((member) => member.staffId));
  for (const member of incoming) {
    if (!member.staffId || seen.has(member.staffId)) continue;
    seen.add(member.staffId);
    result.push(member);
  }
  return result;
}
