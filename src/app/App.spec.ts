// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySettings } from '@/types/settings';
import { useSettings } from '@/composables/useSettings';
import { useCredentials } from '@/composables/useCredentials';
const mocks = vi.hoisted(() => ({ schedule: vi.fn(), hours: vi.fn(), invoke: vi.fn(), calculate: vi.fn(), cancel: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/services/tapd/client', async original => ({ ...await original<typeof import('@/services/tapd/client')>(), fetchScheduleTasks: mocks.schedule }));
vi.mock('@/services/tapd/hours', async original => ({ ...await original<typeof import('@/services/tapd/hours')>(), fetchHoursSnapshot: mocks.hours }));
vi.mock('@/hours/workerClient', () => ({ createHoursCalculator: () => ({ calculate: mocks.calculate, cancel: mocks.cancel }) }));
import App from './App.vue';
import BoardPage from '@/pages/BoardPage.vue';
import HoursPage from '@/pages/HoursPage.vue';
const task = { id: 'a', sourceType: 'task' as const, title: '保活任务', projectId: 'p', projectName: '项目', projectColor: '#3b82f6', assigneeId: '100', assigneeIds: ['100'], assigneeName: '张三', startDate: '2026-10-14', dueDate: '2026-10-14', effort: '8', status: 'open', tapdUrl: 'https://www.tapd.cn/tapd_fe/p/task/detail/a' };
const snapshot = { tasks: [task], records: [], issues: [], status: 'complete' as const };
const scheduleResult = { tasks: [task], errors: [], warnings: [], status: 'complete' as const };
let wrapper: VueWrapper | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T02:00:00Z'));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const settings = createEmptySettings(); settings.projects = [{ id: 'p', name: '项目', color: '#3b82f6', enabled: true }]; settings.members = [{ staffId: '100', name: '张三' }];
  mocks.invoke.mockReset().mockImplementation(async (command: string) => command === 'settings_read' ? JSON.stringify(settings) : command === 'credential_status' ? { configured: true, source: 'file', maskedHint: null } : undefined);
  mocks.schedule.mockReset().mockResolvedValue(scheduleResult); mocks.hours.mockReset().mockResolvedValue(snapshot); mocks.cancel.mockReset();
  mocks.calculate.mockReset().mockImplementation(async input => ({ rows: (await import('@/hours/statistics')).calculateHours(input), calculationMs: 0 }));
  await useSettings().load(true); await useCredentials().refresh();
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
async function start(path = '/board') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/board', name: 'board', component: BoardPage }, { path: '/hours', name: 'hours', component: HoursPage }, { path: '/settings', name: 'settings', component: { template: '<div>设置占位</div>' } }] });
  await router.push(path); await router.isReady(); wrapper = mount(App, { global: { plugins: [router] } }); await flushPromises(); await flushPromises();
  return async (path: string) => { await router.push(path); await flushPromises(); await flushPromises(); };
}
describe('路由保活', () => {
  it('反复切页保留实例、数据、详情、筛选和滚动，超过缓存期限仍不取数', async () => {
    const go = await start(); const board = wrapper!.getComponent(BoardPage); const gantt = board.getComponent({ name: 'GanttBoard' });
    gantt.vm.$emit('select-task', 'task:a'); await flushPromises();
    const timeline = board.get<HTMLElement>('.gantt__timeline'); timeline.element.scrollTop = 30; timeline.element.scrollLeft = 70; await timeline.trigger('scroll');
    await go('/hours'); const hours = wrapper!.getComponent(HoursPage);
    await hours.get('button[aria-label="张三 2026-10-14 预计 8h 预计充足"]').trigger('click'); await hours.get('select[aria-label="成员筛选"]').setValue('100');
    const matrix = hours.get<HTMLElement>('.matrix'); matrix.element.scrollLeft = 80; await matrix.trigger('scroll'); await new Promise(resolve => setTimeout(resolve, 30));
    await go('/settings'); vi.setSystemTime(new Date('2026-10-14T02:02:00Z')); await go('/board');
    expect(wrapper!.getComponent(BoardPage).element === board.element).toBe(true); expect(wrapper!.get('.board__selected').text()).toContain('保活任务');
    expect(wrapper!.get<HTMLElement>('.gantt__timeline').element.scrollLeft).toBe(70);
    await go('/hours'); expect(wrapper!.getComponent(HoursPage).element === hours.element).toBe(true); expect(wrapper!.get('aside').text()).toContain('保活任务');
    expect(wrapper!.get<HTMLSelectElement>('select[aria-label="成员筛选"]').element.value).toBe('100'); expect(wrapper!.get<HTMLElement>('.matrix').element.scrollLeft).toBe(80);
    expect(mocks.schedule).toHaveBeenCalledTimes(1); expect(mocks.hours).toHaveBeenCalledTimes(1); expect(mocks.calculate).toHaveBeenCalledTimes(1);
  });
  it('工时加载在隐藏期间继续完成，返回不重复请求', async () => {
    let finish!: (value: typeof snapshot) => void; mocks.hours.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const go = await start('/hours'); mocks.cancel.mockClear(); await go('/settings'); finish(snapshot); await flushPromises(); await flushPromises();
    expect(mocks.calculate).toHaveBeenCalledTimes(1); expect(mocks.cancel).not.toHaveBeenCalled(); await go('/hours');
    expect(wrapper!.find('.matrix').exists()).toBe(true); expect(mocks.hours).toHaveBeenCalledTimes(1);
  });
  it('看板未完成请求离开后继续，返回显示结果', async () => {
    let finish!: (value: typeof scheduleResult) => void;
    mocks.schedule.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const go = await start(); await go('/settings'); finish(scheduleResult); await flushPromises(); await go('/board');
    expect(mocks.schedule).toHaveBeenCalledTimes(1); expect(wrapper!.text()).toContain('保活任务');
  });
  it('后台计算离开后完成，返回不重算', async () => {
    let finish!: (value: { rows: unknown[]; calculationMs: number }) => void;
    mocks.calculate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const go = await start('/hours'); mocks.cancel.mockClear(); await go('/settings');
    const { calculateHours } = await import('@/hours/statistics'); finish({ rows: calculateHours(mocks.calculate.mock.calls[0][0]), calculationMs: 0 });
    await flushPromises(); await go('/hours'); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.calculate).toHaveBeenCalledTimes(1); expect(wrapper!.find('.matrix').exists()).toBe(true);
  });
  it('隐藏时项目配置多次变化不请求，返回分别按最新配置更新一次', async () => {
    const go = await start(); await go('/hours'); await go('/settings');
    const store = useSettings(); await store.addProject({ id: 'q', name: '新项目' }); await store.updateProject('q', { enabled: true }); await store.updateProject('q', { name: '最终项目' }); await flushPromises();
    expect(mocks.hours).toHaveBeenCalledTimes(1); expect(mocks.schedule).toHaveBeenCalledTimes(1);
    await go('/board'); expect(mocks.schedule).toHaveBeenCalledTimes(2); expect(mocks.schedule.mock.calls[1][0].projects).toHaveLength(2);
    await go('/hours'); expect(mocks.hours).toHaveBeenCalledTimes(2); expect(mocks.hours.mock.calls[1][0].projects[1].name).toBe('最终项目');
  });
  it('隐藏时规则变化延后重算，项目展示信息和成员变更不重拉看板', async () => {
    const go = await start(); await go('/hours'); await go('/settings'); const store = useSettings();
    await store.updateHours({ ...store.settings.value.hours, dailyRequiredHours: 7.5 }); await store.updateProject('p', { name: '新名称', color: '#ff0000' }); await flushPromises();
    expect(mocks.calculate).toHaveBeenCalledTimes(1); await go('/hours'); expect(mocks.calculate).toHaveBeenCalledTimes(2); expect(mocks.hours).toHaveBeenCalledTimes(1);
    await go('/board'); expect(mocks.schedule).toHaveBeenCalledTimes(1); expect(wrapper!.getComponent(BoardPage).getComponent({ name: 'GanttBoard' }).props('tasks')[0].projectName).toBe('新名称');
  });
  it('成员变化只重拉工时，返回看板复用原任务', async () => {
    const go = await start(); await go('/hours'); await go('/settings'); await useSettings().addMembers([{ staffId: '200', name: '李四' }]); await flushPromises();
    expect(mocks.hours).toHaveBeenCalledTimes(1); await go('/board'); expect(mocks.schedule).toHaveBeenCalledTimes(1);
    await go('/hours'); expect(mocks.hours).toHaveBeenCalledTimes(2); expect(mocks.hours.mock.calls[1][0].members).toHaveLength(2);
  });
  it('旧账号请求在隐藏时完成不会作为新账号结果展示', async () => {
    let finish!: (value: typeof snapshot) => void;
    mocks.hours.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const go = await start('/hours'); await go('/settings'); await useCredentials().save('test-only-token');
    finish(snapshot); await flushPromises(); expect(mocks.hours).toHaveBeenCalledTimes(1); expect(mocks.calculate).not.toHaveBeenCalled();
    let finishNew!: (value: typeof snapshot) => void; mocks.hours.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    await go('/hours'); expect(wrapper!.find('.matrix').exists()).toBe(false); expect(mocks.hours).toHaveBeenCalledTimes(2);
    finishNew(snapshot); await flushPromises(); await flushPromises(); expect(wrapper!.find('.matrix').exists()).toBe(true);
  });
  it('跨日返回工时更新一次，手动刷新仍可取数', async () => {
    const go = await start('/hours'); await go('/settings'); vi.setSystemTime(new Date('2026-10-15T02:00:00Z')); await go('/hours');
    expect(mocks.hours).toHaveBeenCalledTimes(2); expect(mocks.hours.mock.calls[1][0].today).toBe('2026-10-15');
    await wrapper!.get('.hours form button[type="button"]').trigger('click'); await flushPromises(); expect(mocks.hours).toHaveBeenCalledTimes(3);
  });
  it('凭据清除隐藏旧数据，卸载释放后台资源', async () => {
    const go = await start(); await go('/hours'); await go('/settings');
    mocks.invoke.mockImplementation(async (command: string) => command === 'credential_status' ? { configured: false, source: 'none', maskedHint: null } : undefined); await useCredentials().clear(); await go('/hours');
    expect(wrapper!.find('.matrix').exists()).toBe(false); expect(wrapper!.text()).toContain('请先在设置中配置'); await go('/board');
    expect(wrapper!.getComponent(BoardPage).getComponent({ name: 'GanttBoard' }).props('tasks')).toEqual([]);
    wrapper!.unmount(); wrapper = undefined; expect(mocks.cancel).toHaveBeenCalled();
  });
});
