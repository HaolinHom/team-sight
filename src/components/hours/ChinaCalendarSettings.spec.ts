// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/types/settings';
import type { CalendarYearCache } from '@/calendar/chinaCalendar';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), fetch: vi.fn() }));
vi.mock('@/services/settings', () => ({ loadSettings: mocks.load, saveSettings: mocks.save }));
vi.mock('@/services/chinaCalendar', () => ({ fetchChinaCalendar: mocks.fetch }));
enableAutoUnmount(afterEach);
const cache: CalendarYearCache = { year: 2026, days: { '2026-10-10': { working: true, name: '国庆节' } }, papers: ['https://www.gov.cn/example'], fetchedAt: '2000-01-01T00:00:00Z' };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-17T03:00:00Z'));
  mocks.load.mockReset(); mocks.save.mockReset().mockResolvedValue(undefined); mocks.fetch.mockReset().mockResolvedValue(cache);
});
afterEach(() => vi.useRealTimers());
async function setup(configure?: (settings: AppSettings) => void) {
  const { createEmptySettings } = await import('@/types/settings');
  const settings = createEmptySettings(); configure?.(settings); mocks.load.mockResolvedValue({ settings });
  const { useSettings } = await import('@/composables/useSettings'); const store = useSettings(); await store.load(true);
  const component = (await import('./ChinaCalendarSettings.vue')).default;
  const wrapper = mount(component); await flushPromises(); return { wrapper, store };
}
describe('各年份可点击状态标签', () => {
  it('红色标签获取时禁用，数据保存前仍为红色，成功后绿色且不另设刷新按钮', async () => {
    let finish!: () => void; mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { wrapper, store } = await setup();
    expect(wrapper.findAll('button')).toHaveLength(1); const tag = wrapper.get('button'); expect(tag.classes()).toContain('is-missing');
    expect(tag.attributes('type')).toBe('button'); await tag.trigger('click'); await flushPromises();
    expect(tag.text()).toBe('获取中…'); expect(tag.attributes('disabled')).toBeDefined(); expect(store.settings.value.chinaCalendar.years[2026]).toBeUndefined();
    finish(); await flushPromises(); expect(tag.text()).toBe('已缓存'); expect(tag.classes()).toContain('is-cached'); expect(wrapper.text()).toContain('获取时间');
    await tag.trigger('click'); await flushPromises(); expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('启用时获取一次，关闭再启用以及重新加载均复用永久缓存', async () => {
    const { wrapper, store } = await setup(); await wrapper.get('input').setValue(true); await flushPromises();
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(store.settings.value.chinaCalendar.enabled).toBe(true);
    await wrapper.get('input').setValue(false); await flushPromises(); await wrapper.get('input').setValue(true); await flushPromises();
    mocks.load.mockResolvedValue({ settings: JSON.parse(JSON.stringify(store.settings.value)) }); await store.load(true); await flushPromises();
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(wrapper.get('button').classes()).toContain('is-cached');
  });
  it('开关保存失败恢复原值，错误可见，随后可以重试', async () => {
    const { wrapper, store } = await setup(); mocks.save.mockRejectedValueOnce(new Error('磁盘失败'));
    await wrapper.get('input').setValue(true); await flushPromises(); expect(wrapper.get<HTMLInputElement>('input').element.checked).toBe(false);
    expect(store.saveError.value).toContain('磁盘失败'); expect(mocks.fetch).not.toHaveBeenCalled();
    await wrapper.get('input').setValue(true); await flushPromises(); expect(wrapper.get<HTMLInputElement>('input').element.checked).toBe(true);
  });
  it('刷新失败保留绿色旧缓存；无缓存保存失败保持红色并允许重试', async () => {
    const { wrapper, store } = await setup(settings => { settings.chinaCalendar.years[2026] = cache; });
    mocks.fetch.mockRejectedValueOnce(new Error('离线')); await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.get('button').classes()).toContain('is-cached'); expect(wrapper.get('[role="alert"]').text()).toContain('继续使用已缓存数据');
    expect(store.settings.value.chinaCalendar.years[2026]).toEqual(cache);
    wrapper.unmount();
    vi.resetModules(); const empty = await setup(); mocks.save.mockRejectedValueOnce(new Error('无法缓存'));
    await empty.wrapper.get('button').trigger('click'); await flushPromises();
    expect(empty.wrapper.get('button').classes()).toContain('is-missing'); expect(empty.wrapper.get('[role="alert"]').text()).toContain('无法缓存');
    await empty.wrapper.get('button').trigger('click'); await flushPromises(); expect(empty.wrapper.get('button').classes()).toContain('is-cached');
  });
  it('年份按倒序排列，已缓存年份与访问所需年份都展示', async () => {
    const { wrapper } = await setup(settings => { settings.chinaCalendar.years[2025] = { ...cache, year: 2025 }; });
    const { useChinaCalendar } = await import('@/composables/useChinaCalendar');
    mocks.fetch.mockRejectedValueOnce(new Error('尚未发布')); await useChinaCalendar().ensure([2027]); await flushPromises();
    expect(wrapper.findAll('li > span:first-child').map(item => item.text())).toEqual(['2027 年', '2026 年', '2025 年']);
    expect(wrapper.findAll('button').map(item => item.text())).toEqual(['未获取', '未获取', '已缓存']);
  });
});
