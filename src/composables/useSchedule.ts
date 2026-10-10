import { ref } from 'vue';

import type { DateRange } from '@/gantt/dateUtils';
import { fetchScheduleTasks } from '@/services/tapd/client';
import type { WorkspaceFetchError } from '@/services/tapd/types';
import type { ProjectConfig, ScheduleTask } from '@/types/schedule';

/**
 * 真实任务数据的拉取与状态。
 * 筛选（项目/成员/状态）与成员解析由看板页组合纯函数完成，这里只负责取数与加载状态。
 */
export function useSchedule() {
  const liveTasks = ref<ScheduleTask[]>([]);
  const errors = ref<WorkspaceFetchError[]>([]);
  const loading = ref(false);
  const lastLoadedAt = ref<string | null>(null);

  async function refresh(projects: readonly ProjectConfig[], range: DateRange): Promise<void> {
    loading.value = true;
    try {
      const result = await fetchScheduleTasks({
        projects: [...projects],
        range,
        types: ['task', 'bug'],
      });
      liveTasks.value = result.tasks;
      errors.value = result.errors;
      lastLoadedAt.value = new Date().toLocaleString();
    } catch (error) {
      errors.value = [
        {
          workspaceId: '(整体加载)',
          type: 'task',
          status: 0,
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    } finally {
      loading.value = false;
    }
  }

  return {
    liveTasks,
    errors,
    loading,
    lastLoadedAt,
    refresh,
  };
}
