import type { ProjectConfig, ScheduleTask } from '@/types/schedule';

/**
 * 甘特图固定验收数据（技术方案 7.6 节要求，用于 §10.3 视觉验收）：
 * 2 个以上成员、每人 3+ 任务、多项目颜色、同成员日期重叠、跨多天任务、
 * 成员任务数不等、含折叠成员，并额外覆盖缺失日期与日期倒挂。
 */
export const GANTT_FIXTURE_PROJECTS: ProjectConfig[] = [
  { id: '63253157', name: '中台项目', enabled: true, color: '#3b82f6' },
  { id: '62120799', name: '商城项目', enabled: true, color: '#10b981' },
  { id: '70000111', name: '数据平台', enabled: true, color: '#f59e0b' },
  { id: '70000222', name: '客户端', enabled: true, color: '#8b5cf6' },
];

function project(id: string): ProjectConfig {
  const found = GANTT_FIXTURE_PROJECTS.find((item) => item.id === id);
  if (!found) throw new Error(`未定义的验收项目：${id}`);
  return found;
}

interface MockSeed {
  id: string;
  sourceType: ScheduleTask['sourceType'];
  title: string;
  projectId: string;
  staffId: string | null;
  assigneeName: string;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority?: string;
  effort?: string;
}

const SEEDS: MockSeed[] = [
  // 张三：4 个任务，含同日重叠与跨多天任务
  {
    id: '9001',
    sourceType: 'task',
    title: '用户登录改造',
    projectId: '63253157',
    staffId: '800100001',
    assigneeName: '张三',
    startDate: '2026-10-01',
    dueDate: '2026-10-08',
    status: 'open',
    priority: 'High',
    effort: '2',
  },
  {
    id: '9002',
    sourceType: 'task',
    title: '订单接口联调',
    projectId: '62120799',
    staffId: '800100001',
    assigneeName: '张三',
    startDate: '2026-10-05',
    dueDate: '2026-10-09',
    status: 'open',
    effort: '3',
  },
  {
    id: '9003',
    sourceType: 'bug',
    title: '修复列表分页异常',
    projectId: '70000111',
    staffId: '800100001',
    assigneeName: '张三',
    startDate: '2026-10-07',
    dueDate: '2026-10-07',
    status: 'closed',
  },
  {
    id: '9004',
    sourceType: 'task',
    title: '跨月任务：结算中心灰度',
    projectId: '63253157',
    staffId: '800100001',
    assigneeName: '张三',
    startDate: '2026-09-25',
    dueDate: '2026-10-06',
    status: 'open',
  },
  // 李四：3 个任务
  {
    id: '9101',
    sourceType: 'task',
    title: '商品页适配',
    projectId: '62120799',
    staffId: '800100002',
    assigneeName: '李四',
    startDate: '2026-10-02',
    dueDate: '2026-10-12',
    status: 'open',
  },
  {
    id: '9102',
    sourceType: 'bug',
    title: '修复结算问题',
    projectId: '70000222',
    staffId: '800100002',
    assigneeName: '李四',
    startDate: '2026-10-09',
    dueDate: '2026-10-14',
    status: 'open',
  },
  {
    id: '9103',
    sourceType: 'task',
    title: '埋点补全',
    projectId: '70000111',
    staffId: '800100002',
    assigneeName: '李四',
    startDate: '2026-10-10',
    dueDate: '2026-10-10',
    status: 'done',
    effort: '0.5',
  },
  // 王五：2 个任务（默认折叠，用于验证折叠后的行错位）
  {
    id: '9201',
    sourceType: 'task',
    title: '发布流水线优化',
    projectId: '70000222',
    staffId: '800100003',
    assigneeName: '王五',
    startDate: '2026-10-03',
    dueDate: '2026-10-15',
    status: 'open',
    effort: '1.5',
  },
  {
    id: '9202',
    sourceType: 'bug',
    title: '灰度回滚预案',
    projectId: '63253157',
    staffId: '800100003',
    assigneeName: '王五',
    startDate: '2026-10-12',
    dueDate: '2026-10-18',
    status: 'open',
  },
  // 边界数据：负责人为空 / 仅截止日 / 双日期缺失 / 日期倒挂
  {
    id: '9301',
    sourceType: 'task',
    title: '待认领：灰度数据校验',
    projectId: '63253157',
    staffId: null,
    assigneeName: '',
    startDate: '2026-10-06',
    dueDate: '2026-10-08',
    status: 'open',
  },
  {
    id: '9302',
    sourceType: 'task',
    title: '仅截止日：回归用例整理',
    projectId: '62120799',
    staffId: '800100002',
    assigneeName: '李四',
    startDate: null,
    dueDate: '2026-10-11',
    status: 'open',
  },
  {
    id: '9303',
    sourceType: 'task',
    title: '双日期缺失：需求澄清',
    projectId: '63253157',
    staffId: '800100001',
    assigneeName: '张三',
    startDate: null,
    dueDate: null,
    status: 'open',
  },
  {
    id: '9304',
    sourceType: 'bug',
    title: '日期倒挂：支付超时排查',
    projectId: '70000111',
    staffId: '800100003',
    assigneeName: '王五',
    startDate: '2026-10-16',
    dueDate: '2026-10-12',
    status: 'open',
  },
];

export const GANTT_FIXTURE_TASKS: ScheduleTask[] = SEEDS.map((seed) => {
  const meta = project(seed.projectId);
  const view = seed.sourceType === 'task' ? 'task' : 'bug';
  return {
    id: seed.id,
    sourceType: seed.sourceType,
    title: seed.title,
    projectId: meta.id,
    projectName: meta.name,
    projectColor: meta.color,
    assigneeId: seed.staffId,
    assigneeName: seed.assigneeName,
    assigneeIds: seed.staffId ? [seed.staffId] : [],
    startDate: seed.startDate,
    dueDate: seed.dueDate,
    status: seed.status,
    priority: seed.priority,
    effort: seed.effort,
    tapdUrl: `https://www.tapd.cn/tapd_fe/${meta.id}/${view}/detail/${seed.id}`,
    rawStatus: seed.status,
  };
});

/** 默认折叠成员（技术方案要求验收数据含一个折叠成员）。 */
export const GANTT_FIXTURE_COLLAPSED_MEMBERS = ['staff:800100003'];
