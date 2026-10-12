import { ref } from 'vue';

import type { DateRange } from '@/gantt/dateUtils';
import { fetchScheduleTasks } from '@/services/tapd/client';
import type { ScheduleFetchResult, WorkspaceFetchError } from '@/services/tapd/types';
import type { ProjectConfig, ScheduleTask } from '@/types/schedule';

/**
 * 真实任务数据的拉取与状态。
 * 筛选（项目/成员/状态）与成员解析由看板页组合纯函数完成，这里只负责取数与加载状态。
 */
export function useSchedule() {
  const liveTasks = ref<ScheduleTask[]>([]);
  const errors = ref<WorkspaceFetchError[]>([]);
  const warnings = ref<WorkspaceFetchError[]>([]);
  const loading = ref(false);
  const lastLoadedAt = ref<string | null>(null);
  const loadedRange = ref<DateRange | null>(null);
  const loadStatus = ref<ScheduleFetchResult['status'] | 'idle'>('idle');
  let requestId = 0;

  async function refresh(projects: readonly ProjectConfig[], range: DateRange): Promise<void> {
    const currentRequestId = ++requestId;
    const requestedRange = { ...range };
    loading.value = true;
    try {
      const result = await fetchScheduleTasks({
        projects: [...projects],
        range: requestedRange,
        types: ['task', 'bug'],
      });
      if (currentRequestId !== requestId) return;
      errors.value = result.errors;
      warnings.value = result.warnings;
      loadStatus.value = result.status;
      if (result.status !== 'failed') {
        liveTasks.value = result.tasks;
        loadedRange.value = requestedRange;
        lastLoadedAt.value = new Date().toLocaleString();
      }
    } catch (error) {
      if (currentRequestId !== requestId) return;
      loadStatus.value = 'failed';
      warnings.value = [];
      errors.value = [
        {
          workspaceId: '(整体加载)',
          type: 'task',
          status: 0,
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    } finally {
      if (currentRequestId === requestId) loading.value = false;
    }
  }

  return {
    liveTasks,
    errors,
    warnings,
    loading,
    lastLoadedAt,
    loadedRange,
    loadStatus,
    refresh,
  };
}
