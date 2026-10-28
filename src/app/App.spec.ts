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
import SettingsPage from '@/pages/SettingsPage.vue';
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
async function start(path = '/board', realSettings = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/board', name: 'board', component: BoardPage }, { path: '/hours', name: 'hours', component: HoursPage }, { path: '/settings', name: 'settings', component: realSettings ? SettingsPage : { template: '<div>设置占位</div>' } }] });
  await router.push(path); await router.isReady(); wrapper = mount(App, { global: { plugins: [router] } }); await flushPromises(); await flushPromises();
  return async (path: string) => { await router.push(path); await flushPromises(); await flushPromises(); };
}
describe('路由保活', () => {
  it('日历草稿统一保存后更新保活工时，复用快照重算且不重新查询', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
    const go=await start('/hours',true);await go('/settings');
    const calculations=mocks.calculate.mock.calls.length;
    await wrapper!.get('[data-date="2026-10-14"]').trigger('click');
    await wrapper!.findAll('button').find(button=>button.text()==='添加成员')!.trigger('click');
    await wrapper!.get('[aria-label="请假工时 1"]').setValue('4');await wrapper!.get('dialog form').trigger('submit');
    expect(useSettings().settings.value.hours.exemptions).toEqual([]);
    await wrapper!.findAll('button').find(button=>button.text()==='保存工时配置')!.trigger('click');await flushPromises();
    expect(mocks.calculate).toHaveBeenCalledTimes(calculations);await go('/hours');
    expect(wrapper!.get('button[aria-label^="张三 2026-10-14 "]').text()).toContain('请假 4h · 目标 4h');
    expect(mocks.calculate).toHaveBeenCalledTimes(calculations+1);expect(mocks.hours).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it('日历开关更新保活看板与工时，复用快照不重新查询TAPD', async () => {
    const go = await start('/board');
    await go('/hours'); await go('/settings');
    const calculations = mocks.calculate.mock.calls.length;
    await useSettings().cacheChinaCalendarYear({ year: 2026, fetchedAt: '2000-01-01T00:00:00Z', papers: ['https://www.gov.cn/example'], days: { '2026-10-01': { working: false, name: '国庆节' }, '2026-10-10': { working: true, name: '补班' }, '2026-10-14': { working: false, name: '测试休假' } } });
    await useSettings().setChinaCalendarEnabled(true); await flushPromises();
    expect(mocks.calculate).toHaveBeenCalledTimes(calculations);
    await go('/board'); const headers = wrapper!.findAll('.gantt__day');
    expect(headers[0].classes()).toContain('gantt__day--weekend'); expect(headers[9].classes()).not.toContain('gantt__day--weekend');
    await go('/hours'); expect(mocks.calculate).toHaveBeenCalledTimes(calculations + 1);
    expect(wrapper!.get('button[aria-label="张三 2026-10-14 预计 8h 非工作日"]').attributes('data-state')).toBe('exempt');
    await useSettings().setChinaCalendarEnabled(false); await flushPromises();
    expect(wrapper!.find('button[aria-label="张三 2026-10-14 预计 8h 预计充足"]').exists()).toBe(true);
    await go('/board'); expect(wrapper!.findAll('.gantt__day')[9].classes()).toContain('gantt__day--weekend');
    expect(mocks.schedule).toHaveBeenCalledTimes(1); expect(mocks.hours).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls.some(call => call[0] === 'china_calendar_get')).toBe(false);
  });
  it('预测完整区间按需获取跨年日历，未发布年份降级提示，切页不重复失败请求', async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command: string, args?: { year: number }) => {
      if (command === 'china_calendar_get') {
        if (args!.year === 2027) throw new Error('尚未发布');
        return JSON.stringify({ year: 2026, papers: ['https://www.gov.cn/example'], days: [{ date: '2026-10-10', name: '国庆节', isOffDay: false }] });
      }
      return original(command, args);
    });
    await useSettings().setChinaCalendarEnabled(true);
    mocks.hours.mockResolvedValue({ ...snapshot, tasks: [{ ...task, dueDate: '2027-01-04' }] });
    const go = await start('/hours');
    const calendarRequests = () => mocks.invoke.mock.calls.filter(call => call[0] === 'china_calendar_get');
    expect(calendarRequests().map(call => call[1].year).sort()).toEqual([2026, 2027]);
    expect(wrapper!.text()).toContain('2027 年节假日日历未获取'); expect(wrapper!.text()).toContain('暂按周一至周五');
    expect(useSettings().settings.value.chinaCalendar.years[2026]).toBeDefined();
    await go('/settings'); await go('/hours'); expect(calendarRequests()).toHaveLength(2); expect(mocks.hours).toHaveBeenCalledTimes(1);
  });
  it('从设置保存项目名称后统一更新保活页面，保留详情筛选折叠滚动且不查询或重算', async () => {
    let saved = JSON.stringify(useSettings().settings.value);
    mocks.invoke.mockImplementation(async (command: string, args?: { settingsJson: string }) => {
      if (command === 'settings_read') return saved;
      if (command === 'settings_write') saved = args!.settingsJson;
      if (command === 'credential_status') return { configured: true, source: 'file', maskedHint: null };
    });
    mocks.hours.mockResolvedValue({ ...snapshot, status: 'partial', issues: [{ projectId: 'p', affects: 'both', message: '记录缺失' }] });
    const go = await start('/board', true);
    const board = wrapper!.getComponent(BoardPage);
    const gantt = board.getComponent({ name: 'GanttBoard' });
    gantt.vm.$emit('select-task', 'task:a');
    gantt.vm.$emit('toggle-member', 'staff:100');
    const timeline = board.get<HTMLElement>('.gantt__timeline'); timeline.element.scrollLeft = 70;
    await go('/hours');
    await wrapper!.get('button[aria-label^="张三 2026-10-14 "]').trigger('click');
    await wrapper!.get('select[aria-label="明细项目筛选"]').setValue('p');
    const matrix = wrapper!.get<HTMLElement>('.matrix'); matrix.element.scrollLeft = 80;
    await go('/settings');
    await wrapper!.get('[aria-label="编辑项目 p 的名称"]').trigger('click');
    await wrapper!.get('input[aria-label="项目 p 的名称"]').setValue(' 简称 ');
    await wrapper!.get('.project-name-editor').trigger('submit'); await flushPromises();
    expect(JSON.parse(saved).projects[0].name).toBe('简称');
    await go('/board');
    expect(wrapper!.get('.board__selected').text()).toContain('[简称] 保活任务');
    expect(board.getComponent({ name: 'FilterPanel' }).props('projects')[0].name).toBe('简称');
    expect(gantt.props('collapsedMemberKeys')).toEqual(['staff:100']);
    expect(board.get<HTMLElement>('.gantt__timeline').element.scrollLeft).toBe(70);
    gantt.vm.$emit('toggle-member', 'staff:100'); await flushPromises();
    expect(board.get('.gantt__task-title').text()).toContain('[简称]');
    await board.get('.gantt__bar').trigger('mouseenter', { clientX: 300, clientY: 300 });
    expect(board.get('[role="tooltip"]').text()).toContain('简称');
    expect(board.get('.board__selected a').attributes('href')).toBe(task.tapdUrl);
    await go('/hours');
    expect(wrapper!.get('aside article .meta').text()).toContain('简称');
    expect(wrapper!.get('aside ul.error').text()).toContain('简称：记录缺失');
    expect(wrapper!.get('details.notice').text()).toContain('简称：记录缺失');
    expect(wrapper!.get<HTMLSelectElement>('select[aria-label="明细项目筛选"]').element.value).toBe('p');
    expect(wrapper!.get<HTMLElement>('.matrix').element.scrollLeft).toBe(80);
    expect(wrapper!.get('aside article a').attributes('href')).toBe(task.tapdUrl);
    expect(mocks.schedule).toHaveBeenCalledTimes(1); expect(mocks.hours).toHaveBeenCalledTimes(1); expect(mocks.calculate).toHaveBeenCalledTimes(1);
  });
  it('设置排序后两个保活页面更新顺序，保留筛选详情和折叠且不重新取数', async () => {
    await useSettings().addMembers([{ staffId: '200', name: '李四' }]);
    let saved = JSON.stringify(useSettings().settings.value);
    mocks.invoke.mockImplementation(async (command: string, args?: { settingsJson: string }) => {
      if (command === 'settings_read') return saved;
      if (command === 'settings_write') saved = args!.settingsJson;
      if (command === 'credential_status') return { configured: true, source: 'file', maskedHint: null };
    });
    const secondTask = { ...task, id: 'b', title: '李四任务', assigneeId: '200', assigneeIds: ['200'], assigneeName: '李四' };
    mocks.schedule.mockResolvedValue({ ...scheduleResult, tasks: [secondTask, task] });
    mocks.hours.mockResolvedValue({ ...snapshot, tasks: [secondTask, task] });
    const go = await start('/board', true);
    const board = wrapper!.getComponent(BoardPage);
    expect(board.findAll('.gantt__member-name').map(item => item.text())).toEqual(['张三', '李四']);
    const gantt = board.getComponent({ name: 'GanttBoard' });
    gantt.vm.$emit('select-task', 'task:a'); gantt.vm.$emit('toggle-member', 'staff:100');
    await go('/hours');
    await wrapper!.get('button[aria-label="张三 2026-10-14 预计 8h 预计充足"]').trigger('click');
    await wrapper!.get('select[aria-label="成员筛选"]').setValue('100');
    await go('/settings');
    await wrapper!.get('button[aria-label="前移 李四"]').trigger('click'); await flushPromises();
    expect(mocks.calculate).toHaveBeenCalledTimes(1);
    await go('/board');
    expect(wrapper!.findAll('.gantt__member-name').map(item => item.text())).toEqual(['李四', '张三']);
    expect(wrapper!.get('.board__selected').text()).toContain('保活任务');
    expect(gantt.props('collapsedMemberKeys')).toEqual(['staff:100']);
    await go('/hours');
    expect(wrapper!.get<HTMLSelectElement>('select[aria-label="成员筛选"]').element.value).toBe('100');
    expect(wrapper!.get('aside').text()).toContain('保活任务');
    expect(wrapper!.findAll('select[aria-label="成员筛选"] option').map(item => item.attributes('value'))).toEqual(['', '200', '100']);
    await wrapper!.get('select[aria-label="成员筛选"]').setValue('');
    expect(wrapper!.findAll('.data-row .member-column > strong').map(item => item.text())).toEqual(['李四', '张三']);
    expect(mocks.calculate).toHaveBeenCalledTimes(2);
    expect(mocks.hours).toHaveBeenCalledTimes(1); expect(mocks.schedule).toHaveBeenCalledTimes(1);
    await go('/settings');
    expect(wrapper!.findAll('.member-order .mono').map(item => item.text())).toEqual(['200', '100']);
  });

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
