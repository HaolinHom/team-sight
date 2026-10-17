// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchChinaCalendar } from './chinaCalendar';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const body = { year: 2026, papers: ['https://www.gov.cn/example'], days: [{ date: '2026-10-10', name: '国庆节', isOffDay: false }] };
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
describe('日历传输', () => {
  it('桌面命令仅传年份，不带TAPD凭据', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invoke.mockResolvedValueOnce(JSON.stringify(body));
    expect((await fetchChinaCalendar(2026)).days['2026-10-10'].working).toBe(true);
    expect(invoke).toHaveBeenCalledWith('china_calendar_get', { year: 2026 });
  });
  it('浏览器主源格式无效或HTTP失败时回退Raw，禁用浏览器缓存', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => body });
    vi.stubGlobal('fetch', fetch); await fetchChinaCalendar(2026);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json', 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json']);
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  });
  it('全部失败返回错误，非法年份不发请求', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal('fetch', fetch);
    await expect(fetchChinaCalendar(2027)).rejects.toThrow('HTTP 404'); expect(fetch).toHaveBeenCalledTimes(2);
    await expect(fetchChinaCalendar(0)).rejects.toThrow('年份无效'); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
