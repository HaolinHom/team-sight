// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentMonthRange } from '@/gantt/dateUtils';
import type { ScheduleTask } from '@/types/schedule';

const invokeMock = vi.hoisted(() => vi.fn());
const fetchScheduleTasksMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/services/tapd/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tapd/client')>();
  return { ...actual, fetchScheduleTasks: fetchScheduleTasksMock };
});

const BoardPage = (await import('./BoardPage.vue')).default;

const PROJECT_ID = '63253157';

const SETTINGS = {
  schemaVersion: 1,
  projects: [{ id: PROJECT_ID, name: '巨像销售中台产品线', enabled: true, color: '#3b82f6' }],
  members: [
    { staffId: '800100001', name: '张三' },
    { staffId: '800100002', name: '李四' },
  ],
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function task(partial: Partial<ScheduleTask> & Pick<ScheduleTask, 'id' | 'title'>): ScheduleTask {
  return {
    sourceType: 'task',
    projectId: PROJECT_ID,
    projectName: '巨像销售中台产品线',
    projectColor: '#3b82f6',
    assigneeId: '800100001',
    assigneeName: '张三',
    assigneeIds: ['800100001'],
    startDate: '2026-10-01',
    dueDate: '2026-10-08',
    status: 'open',
    tapdUrl: `https://www.tapd.cn/tapd_fe/${PROJECT_ID}/task/detail/${partial.id}`,
    ...partial,
  };
}

const TASKS: ScheduleTask[] = [
  task({ id: '1', title: '用户登录改造', effort: '2' }),
  task({
    id: '2',
    title: '接口联调',
    status: 'done',
    startDate: '2026-10-05',
    dueDate: '2026-10-09',
  }),
  task({
    id: '3',
    title: '商品页适配',
    assigneeId: '800100002',
    assigneeName: '李四',
    assigneeIds: ['800100002'],
    startDate: '2026-10-12',
    dueDate: '2026-10-14',
  }),
];

function stubTauriRuntime(): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

async function mountBoard(): Promise<VueWrapper> {
  const wrapper = mount(BoardPage, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

function openDropdown(wrapper: VueWrapper, index: number): Promise<void> {
  return wrapper.findAll('.filters__toggle')[index].trigger('click');
}

function optionByText(wrapper: VueWrapper, text: string) {
  const option = wrapper.findAll('.filters__option').find((item) => item.text().includes(text));
  if (!option) throw new Error(`未找到筛选项：${text}`);
  return option;
}

beforeEach(() => {
  stubTauriRuntime();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'settings_read') return JSON.stringify(SETTINGS);
    if (command === 'credential_status') {
      return { configured: true, source: 'file', maskedHint: 'f9b7…cdef' };
    }
    return undefined;
  });
  fetchScheduleTasksMock.mockResolvedValue({ tasks: TASKS, errors: [], warnings: [], status: 'complete' });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  invokeMock.mockReset();
  fetchScheduleTasksMock.mockReset();
});

describe('BoardPage 默认视图', () => {
  it('默认时间范围为当前自然月', async () => {
    const wrapper = await mountBoard();
    const range = currentMonthRange();

    const start = wrapper.find<HTMLInputElement>('input[aria-label="开始日期"]');
    const end = wrapper.find<HTMLInputElement>('input[aria-label="结束日期"]');

    expect(start.element.value).toBe(range.start);
    expect(end.element.value).toBe(range.end);
  });

  it('加载后每个任务独占一行，成员分组按配置呈现', async () => {
    const wrapper = await mountBoard();

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(TASKS.length);
    // 成员分组按中文拼音排序（李四 L 在 张三 Z 之前）
    expect(wrapper.findAll('.gantt__member-name').map((item) => item.text())).toEqual([
      '李四',
      '张三',
    ]);
  });
});

describe('BoardPage 筛选', () => {
  it('取消勾选成员后任务行与分组同步更新', async () => {
    const wrapper = await mountBoard();

    await openDropdown(wrapper, 1);
    await optionByText(wrapper, '李四').find('input').setValue(false);

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(2);
    expect(wrapper.findAll('.gantt__member-name').map((item) => item.text())).toEqual(['张三']);
    expect(wrapper.text()).toContain('未命中展示成员 1 条');
  });

  it('取消勾选状态后隐藏对应任务', async () => {
    const wrapper = await mountBoard();

    await openDropdown(wrapper, 2);
    await optionByText(wrapper, 'done').find('input').setValue(false);

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('接口联调');
  });

  it('筛选后没有匹配任务时显示筛选空状态', async () => {
    const wrapper = await mountBoard();

    await openDropdown(wrapper, 0);
    await wrapper.findAll('.filters__panel-actions button')[1].trigger('click');

    expect(wrapper.text()).toContain('当前筛选条件下没有可展示的任务');
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(0);
  });
});

describe('BoardPage 详情与链接', () => {
  it('点击任务条显示详情要点与正确的 TAPD 链接', async () => {
    const wrapper = await mountBoard();

    await wrapper.find('.gantt__bar[data-task-key="task:1"]').trigger('click');

    const footer = wrapper.find('.board__selected');
    expect(footer.text()).toContain('用户登录改造');
    expect(footer.text()).toContain('负责人：张三');
    expect(footer.text()).toContain('预估工时：2');
    expect(footer.find('a').attributes('href')).toBe(
      `https://www.tapd.cn/tapd_fe/${PROJECT_ID}/task/detail/1`
    );
  });
});

describe('BoardPage 异常状态', () => {
  it('部分项目失败时保留成功数据并给出可执行提示', async () => {
    fetchScheduleTasksMock.mockResolvedValueOnce({
      warnings: [],
      status: 'partial',
      tasks: TASKS,
      errors: [{ workspaceId: '62120799', type: 'bug', status: 403, message: 'no permission' }],
    });

    const wrapper = await mountBoard();

    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(TASKS.length);
    expect(wrapper.text()).toContain('无访问权限');
  });

  it('整体加载失败时显示错误而不是静默', async () => {
    fetchScheduleTasksMock.mockRejectedValueOnce(new Error('网络中断'));

    const wrapper = await mountBoard();

    expect(wrapper.text()).toContain('(整体加载)');
    expect(wrapper.text()).toContain('网络中断');
  });

  it('读取凭据失败时提示原因并回到未配置状态', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'settings_read') return JSON.stringify(SETTINGS);
      if (command === 'credential_status') throw new Error('凭据文件格式异常');
      return undefined;
    });

    const wrapper = await mountBoard();

    expect(wrapper.text()).toContain('读取凭据失败');
    expect(wrapper.text()).toContain('尚未配置 TAPD 令牌');
    expect(fetchScheduleTasksMock).not.toHaveBeenCalled();
  });
});

const failedResult = {
  tasks: [], warnings: [], status: 'failed',
  errors: [{ workspaceId: PROJECT_ID, type: 'task', status: 403, message: '无权限' }],
};

describe('看板数据完整性与旧数据', () => {
  it('全部数据源失败时不显示正常空状态或成功刷新时间', async () => {
    fetchScheduleTasksMock.mockResolvedValueOnce(failedResult);
    const wrapper = await mountBoard();
    expect(wrapper.text()).toContain('全部数据源加载失败');
    expect(wrapper.text()).not.toContain('部分数据源加载失败');
    expect(wrapper.text()).not.toContain('当前时间范围内没有可展示的任务');
    expect(wrapper.text()).not.toContain('最后成功刷新');
    wrapper.unmount();
  });

  it('同范围刷新失败时保留旧任务并标注旧数据', async () => {
    const wrapper = await mountBoard();
    fetchScheduleTasksMock.mockResolvedValueOnce(failedResult);
    await wrapper.get('.board__toolbar button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(TASKS.length);
    expect(wrapper.text()).toContain('上次成功加载的旧数据');
    expect(wrapper.text()).toContain('全部数据源加载失败');
    wrapper.unmount();
  });

  it('切换月份加载期间及失败后不展示其他月份的旧任务', async () => {
    const wrapper = await mountBoard();
    let finish!: (value: typeof failedResult) => void;
    fetchScheduleTasksMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await wrapper.findAll('.filters__range button')[2].trigger('click');
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(0);
    expect(wrapper.text()).toContain('已隐藏旧任务');
    finish(failedResult);
    await flushPromises();
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(0);
    expect(wrapper.text()).toContain('全部数据源加载失败');
    expect(wrapper.text()).toContain('已隐藏旧任务');
    wrapper.unmount();
  });

  it('分页截断显示不完整提示并保留已拉取任务', async () => {
    fetchScheduleTasksMock.mockResolvedValueOnce({
      tasks: TASKS, errors: [], status: 'partial',
      warnings: [{ workspaceId: PROJECT_ID, type: 'task', status: 0, message: '已达到50页安全上限' }],
    });
    const wrapper = await mountBoard();
    expect(wrapper.findAll('.gantt__label-row--task')).toHaveLength(TASKS.length);
    expect(wrapper.text()).toContain('数据不完整');
    expect(wrapper.text()).toContain('安全上限');
    expect(wrapper.text()).not.toContain('全部数据源加载失败');
    wrapper.unmount();
  });
});
