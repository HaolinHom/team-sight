import { createHoursCache } from '@/services/tapd/hoursCache';
const hoursCache = createHoursCache();
import { ref, shallowRef } from 'vue';
import { fetchHoursSnapshot, type HoursQuery } from '@/services/tapd/hours';
import type { HoursSnapshot } from '@/types/hours';

export function hoursQueryKey(query: HoursQuery): string {
  return JSON.stringify({ projects: query.projects.filter(project => project.enabled).map(project => project.id).sort(), members: query.members.map(member => member.staffId).sort(), range: query.range, today: query.today, completedStates: query.settings.completedStates, credentialRevision: query.credentialRevision ?? 0 });
}

export function useHours() {
  const snapshot = shallowRef<HoursSnapshot | null>(null);
  const loadedKey = ref('');
  const lastLoadedAt = ref('');
  const loading = ref(false);
  const error = ref('');
  const stale = ref(false);
  let requestId = 0;
  let controller: AbortController | undefined;
  const progress = shallowRef<{ stage: string; completed: number; total: number } | null>(null);

  async function refresh(query: HoursQuery, force = false): Promise<void> {
    query = JSON.parse(JSON.stringify(query)) as HoursQuery;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const id = ++requestId;
    const key = hoursQueryKey(query);
    loading.value = true;
    stale.value = !!snapshot.value;
    try {
      const result = await fetchHoursSnapshot(query, undefined, { signal, cache: hoursCache, force, onProgress: value => { if (id === requestId) progress.value = value; } });
      if (id !== requestId) return;
      if (result.status === 'failed') {
        error.value = result.issues.map(issue => issue.message).join('；') || '全部工时数据源加载失败';
        stale.value = true;
      } else {
        snapshot.value = result;
        loadedKey.value = key;
        lastLoadedAt.value = new Date(result.fetchedAt ?? Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        error.value = '';
        stale.value = false;
      }
    } catch (failure) {
      if (id !== requestId) return;
      error.value = failure instanceof Error ? failure.message : String(failure);
      stale.value = true;
    } finally {
      if (id === requestId) { loading.value = false; progress.value = null; }
    }
  }

  function invalidate(): void {
    controller?.abort();
    requestId++;
    progress.value = null;
    loading.value = false;
    stale.value = true;
  }
  return { snapshot, loadedKey, lastLoadedAt, loading, error, stale, progress, refresh, invalidate };
}
