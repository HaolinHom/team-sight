import { describe, expect, it, vi } from 'vitest';
import { createCalendarLoader } from './useChinaCalendar';
import type { CalendarYearCache } from '@/calendar/chinaCalendar';

const cache: CalendarYearCache = { year: 2026, days: { '2026-10-10': { working: true, name: '补班' } }, papers: ['https://www.gov.cn/example'], fetchedAt: '2000-01-01T00:00:00Z' };
function setup(existing?: CalendarYearCache) {
  const years: Record<number, CalendarYearCache> = existing ? { [existing.year]: existing } : {};
  const fetch = vi.fn().mockResolvedValue(cache), save = vi.fn(async (value: CalendarYearCache) => { years[value.year] = value; return true; });
  const loader = createCalendarLoader({ cached: year => years[year], fetch, save, saveError: () => '磁盘写入失败' });
  return { ...loader, fetch, save, years };
}
describe('永久日历缓存与请求控制', () => {
  it('旧缓存永不过期，多次激活和重新创建加载器均不请求，只有手动刷新才获取', async () => {
    const loader = setup(cache); await loader.ensure([2026]); await loader.ensure([2026]);
    expect(loader.fetch).not.toHaveBeenCalled();
    const restarted = setup(JSON.parse(JSON.stringify(cache))); await restarted.ensure([2026]); expect(restarted.fetch).not.toHaveBeenCalled();
    await loader.refresh(2026); expect(loader.fetch).toHaveBeenCalledOnce(); expect(loader.save).toHaveBeenCalledOnce();
  });
  it('同年自动获取与手动刷新合并，保存完成之前不标记已缓存', async () => {
    const loader = setup(); let finish!: (cache: CalendarYearCache) => void;
    loader.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = loader.ensure([2026]), second = loader.refresh(2026); await Promise.resolve();
    expect(loader.fetch).toHaveBeenCalledOnce(); expect(loader.loading.value[2026]).toBe(true); expect(loader.years[2026]).toBeUndefined();
    finish(cache); await Promise.all([first, second]); expect(loader.years[2026]).toEqual(cache); expect(loader.loading.value[2026]).toBe(false);
  });
  it('失败不自动重复请求，手动点击可以重试', async () => {
    const loader = setup(); loader.fetch.mockRejectedValueOnce(new Error('offline'));
    await loader.ensure([2026]); await loader.ensure([2026]); expect(loader.fetch).toHaveBeenCalledOnce(); expect(loader.errors.value[2026]).toBe('offline');
    await loader.refresh(2026); expect(loader.fetch).toHaveBeenCalledTimes(2); expect(loader.errors.value[2026]).toBe('');
  });
  it('刷新或保存失败保留旧数据，未缓存时保存失败不出现假成功', async () => {
    const loader = setup(cache); loader.fetch.mockRejectedValueOnce(new Error('offline')); await loader.refresh(2026); expect(loader.years[2026]).toBe(cache);
    loader.save.mockResolvedValueOnce(false); await loader.refresh(2026); expect(loader.years[2026]).toBe(cache); expect(loader.errors.value[2026]).toContain('磁盘');
    const empty = setup(); empty.save.mockResolvedValueOnce(false); await empty.refresh(2026); expect(empty.years[2026]).toBeUndefined();
  });
});
