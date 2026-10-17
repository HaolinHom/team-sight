import { computed, ref } from 'vue';

import { loadSettings, saveSettings } from '@/services/settings';
import {
  createEmptySettings,
  mergeMembers,
  pickProjectColor,
  type AppSettings,
  type MemberEntry,
} from '@/types/settings';
import type { ProjectConfig } from '@/types/schedule';
import type { HoursSettings } from '@/types/hours';
import { validateHoursSettings } from '@/hours/settings';
import type { CalendarYearCache } from '@/calendar/chinaCalendar';

/**
 * 配置状态在模块级共享，保证设置页与看板页看到同一份数据。
 * 持久层由 `src/services/settings.ts` 决定（桌面端 JSON 文件 / 浏览器 localStorage）。
 */
const settings = ref<AppSettings>(createEmptySettings());
const loading = ref(false);
const warning = ref('');
const loaded = ref(false);
const saveError = ref('');
let saveQueue: Promise<void> = Promise.resolve();

async function load(force = false): Promise<void> {
  if (loaded.value && !force) return;
  await saveQueue;
  loading.value = true;
  try {
    const result = await loadSettings();
    settings.value = result.settings;
    warning.value = result.warning ?? '';
    loaded.value = true;
  } finally {
    loading.value = false;
  }
}

/** 连续操作按最新已保存配置计算；磁盘写入成功后才发布内存状态。 */
function persist(update: (current: AppSettings) => AppSettings): Promise<boolean> {
  const operation = saveQueue.then(async () => {
    try {
      const next = update(settings.value);
      if (next === settings.value) { saveError.value = ''; return true; }
      await saveSettings(next);
      settings.value = next;
      saveError.value = '';
      return true;
    } catch (error) {
      saveError.value = `保存配置失败：${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  });
  saveQueue = operation.then(() => undefined);
  return operation;
}

/** 新增项目：名称以 TAPD 为准，默认禁用，颜色从未占用色中随机分配。 */
async function addProject(project: { id: string; name: string }): Promise<boolean> {
  let added = false;
  const saved = await persist((current) => {
    if (current.projects.some((item) => item.id === project.id)) return current;
    added = true;
    return {
      ...current,
      projects: [...current.projects, {
        id: project.id,
        name: project.name || `项目 ${project.id}`,
        enabled: false,
        color: pickProjectColor(current.projects.map((item) => item.color)),
      }],
    };
  });
  return saved && added;
}

async function updateProject(id: string, patch: Partial<ProjectConfig>): Promise<boolean> {
  const changes = { ...patch };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      saveError.value = '项目名称不能为空';
      return false;
    }
  }
  return persist((current) => {
    const project = current.projects.find((item) => item.id === id);
    if (!project || Object.entries(changes).every(([key, value]) => project[key as keyof ProjectConfig] === value)) return current;
    return {
      ...current,
      projects: current.projects.map((item) => item.id === id ? { ...item, ...changes } : item),
    };
  });
}

async function removeProject(id: string): Promise<void> {
  await persist((current) => ({
    ...current,
    projects: current.projects.filter((item) => item.id !== id),
  }));
}

async function addMembers(entries: readonly MemberEntry[]): Promise<number> {
  let added = 0;
  const saved = await persist((current) => {
    const members = mergeMembers(current.members, entries);
    added = members.length - current.members.length;
    return added > 0 ? { ...current, members } : current;
  });
  return saved ? added : 0;
}

async function removeMember(staffId: string): Promise<void> {
  await persist((current) => ({
    ...current,
    members: current.members.filter((item) => item.staffId !== staffId),
  }));
}

async function moveMember(
  staffId: string,
  targetStaffId: string,
  placement: 'before' | 'after'
): Promise<boolean> {
  return persist((current) => {
    if (staffId === targetStaffId) return current;
    const member = current.members.find((item) => item.staffId === staffId);
    if (!member || !current.members.some((item) => item.staffId === targetStaffId)) return current;
    const members = current.members.filter((item) => item.staffId !== staffId);
    const targetIndex = members.findIndex((item) => item.staffId === targetStaffId);
    members.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, member);
    if (members.every((item, index) => item === current.members[index])) return current;
    return { ...current, members };
  });
}

async function updateHours(hours: HoursSettings): Promise<boolean> {
  const error = validateHoursSettings(hours);
  if (error) {
    saveError.value = error;
    return false;
  }
  const savedHours = JSON.parse(JSON.stringify(hours)) as HoursSettings;
  return persist((current) => ({ ...current, hours: savedHours }));
}

async function setChinaCalendarEnabled(enabled: boolean): Promise<boolean> {
  return persist(current => current.chinaCalendar.enabled === enabled ? current : {
    ...current, chinaCalendar: { ...current.chinaCalendar, enabled },
  });
}

async function cacheChinaCalendarYear(cache: CalendarYearCache): Promise<boolean> {
  const saved = JSON.parse(JSON.stringify(cache)) as CalendarYearCache;
  return persist(current => ({ ...current, chinaCalendar: {
    ...current.chinaCalendar, years: { ...current.chinaCalendar.years, [saved.year]: saved },
  } }));
}

export function useSettings() {
  const enabledProjects = computed(() => settings.value.projects.filter((item) => item.enabled));

  return {
    settings,
    loading,
    warning,
    saveError,
    load,
    enabledProjects,
    addProject,
    updateProject,
    removeProject,
    addMembers,
    removeMember,
    moveMember,
    updateHours,
    setChinaCalendarEnabled,
    cacheChinaCalendarYear,
  };
}
