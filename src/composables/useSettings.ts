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

async function load(force = false): Promise<void> {
  if (loaded.value && !force) return;
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

async function persist(): Promise<void> {
  await saveSettings(settings.value);
}

/** 新增项目：名称以 TAPD 为准，默认禁用，颜色从未占用色中随机分配。 */
async function addProject(project: { id: string; name: string }): Promise<boolean> {
  if (settings.value.projects.some((item) => item.id === project.id)) return false;
  settings.value.projects.push({
    id: project.id,
    name: project.name || `项目 ${project.id}`,
    enabled: false,
    color: pickProjectColor(settings.value.projects.map((item) => item.color)),
  });
  await persist();
  return true;
}

async function updateProject(id: string, patch: Partial<ProjectConfig>): Promise<void> {
  const index = settings.value.projects.findIndex((item) => item.id === id);
  if (index < 0) return;
  settings.value.projects[index] = { ...settings.value.projects[index], ...patch };
  await persist();
}

async function removeProject(id: string): Promise<void> {
  settings.value.projects = settings.value.projects.filter((item) => item.id !== id);
  await persist();
}

async function addMembers(entries: readonly MemberEntry[]): Promise<number> {
  const before = settings.value.members.length;
  settings.value.members = mergeMembers(settings.value.members, entries);
  const added = settings.value.members.length - before;
  if (added > 0) await persist();
  return added;
}

async function removeMember(staffId: string): Promise<void> {
  settings.value.members = settings.value.members.filter((item) => item.staffId !== staffId);
  await persist();
}

export function useSettings() {
  const enabledProjects = computed(() => settings.value.projects.filter((item) => item.enabled));

  return {
    settings,
    loading,
    warning,
    load,
    enabledProjects,
    addProject,
    updateProject,
    removeProject,
    addMembers,
    removeMember,
  };
}
