import type { RawRow } from './types';
export interface HoursPageResult { rows: RawRow[]; complete: boolean; error?: string; fetchedAt?: number }
/** 只缓存完整查询，最多 512 项／40000 行，超大响应不驻留。 */
export function createHoursCache(ttl = 60000) {
  const entries = new Map<string, { result: HoursPageResult; expires: number }>();
  let rows = 0;
  function remove(key: string): void { const item = entries.get(key); if (item) rows -= item.result.rows.length; entries.delete(key); }
  function get(key: string): HoursPageResult | undefined {
    const item = entries.get(key);
    if (!item) return;
    if (item.expires <= Date.now()) { remove(key); return; }
    entries.delete(key); entries.set(key, item);
    return item.result;
  }
  function set(key: string, result: HoursPageResult): void {
    if (!result.complete || result.rows.length > 2000) return;
    remove(key); entries.set(key, { result, expires: Date.now() + ttl }); rows += result.rows.length;
    while (entries.size > 512 || rows > 40000) remove(entries.keys().next().value!);
  }
  function clear(prefix = ''): void { for (const key of entries.keys()) if (key.startsWith(prefix)) remove(key); }
  return { get, set, clear };
}
export type HoursCache = ReturnType<typeof createHoursCache>;
