import { computed, ref } from 'vue';

import type { DateRange } from '@/gantt/dateUtils';
import { fetchScheduleTasks } from '@/services/tapd/client';
import type { WorkspaceFetchError } from '@/services/tapd/types';
import type { ProjectConfig, ScheduleTask } from '@/types/schedule';
import { expandTasksByMember, resolveTaskMembers } from '@/utils/memberResolution';

import { useSettings } from './useSettings';

/**
 * 真实任务数据 + 成员过滤。
 * 过滤只作用于已获取的数据，不触发额外网络请求。
 */
export function useSchedule() {
  const { settings } = useSettings();
  const liveTasks = ref<ScheduleTask[]>([]);
  const errors = ref<WorkspaceFetchError[]>([]);
  const loading = ref(false);
  const lastLoadedAt = ref<string | null>(null);
  const statusText = ref('');

  const expansion = computed(() => expandTasksByMember(liveTasks.value, settings.value.members));
  const memberNames = computed(() => expansion.value.namesByMember);
  const hiddenTaskCount = computed(() => expansion.value.hiddenTaskCount);

  function memberKeysOf(task: ScheduleTask): string[] {
    return resolveTaskMembers(task, settings.value.members).map((member) => member.key);
  }

  async function refresh(projects: readonly ProjectConfig[], range: DateRange): Promise<void> {
    loading.value = true;
    statusText.value = '正在拉取 TAPD 数据…';
    try {
      const result = await fetchScheduleTasks({
        projects: [...projects],
        range,
        types: ['task', 'bug'],
      });
      liveTasks.value = result.tasks;
      errors.value = result.errors;
      lastLoadedAt.value = new Date().toLocaleString();
      statusText.value = `已加载 ${result.tasks.length} 条工作项（${range.start} ~ ${range.end}）`;
    } catch (error) {
      statusText.value = `加载失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loading.value = false;
    }
  }

  return {
    liveTasks,
    errors,
    loading,
    lastLoadedAt,
    statusText,
    hiddenTaskCount,
    memberNames,
    memberKeysOf,
    refresh,
  };
}
