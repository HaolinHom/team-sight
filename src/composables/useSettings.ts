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
      if (next === settings.value) return true;
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

async function updateProject(id: string, patch: Partial<ProjectConfig>): Promise<void> {
  await persist((current) => ({
    ...current,
    projects: current.projects.map((project) => project.id === id ? { ...project, ...patch } : project),
  }));
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
  };
}
