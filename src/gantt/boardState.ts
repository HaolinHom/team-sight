/** 看板展示状态：页面只负责渲染，判定集中在纯函数里。 */
export type BoardStateKind =
  | 'loading'
  | 'fixture'
  | 'no-credential'
  | 'no-projects'
  | 'no-members'
  | 'empty'
  | 'ready';

export interface BoardStateInput {
  loading: boolean;
  fixtureMode: boolean;
  isDesktop: boolean;
  credentialConfigured: boolean;
  enabledProjectCount: number;
  memberCount: number;
  taskCount: number;
}

export interface BoardState {
  kind: BoardStateKind;
  message: string;
  hint: string;
}

const DESKTOP_ONLY_HINT =
  '浏览器模式无法直连 TAPD；真实数据请在桌面端查看，或使用 VITE_BOARD_FIXTURE=1 做视觉验收。';

export function resolveBoardState(input: BoardStateInput): BoardState {
  const browserHint = input.isDesktop ? '' : DESKTOP_ONLY_HINT;

  if (input.loading) {
    return { kind: 'loading', message: '正在加载排期数据…', hint: '' };
  }

  if (input.fixtureMode) {
    return {
      kind: 'fixture',
      message: '当前为视觉验收固定数据（VITE_BOARD_FIXTURE=1），未请求 TAPD。',
      hint: '',
    };
  }

  if (!input.credentialConfigured) {
    return {
      kind: 'no-credential',
      message: '尚未配置 TAPD 令牌，无法加载排期数据。',
      hint: browserHint || '请到「设置」页保存令牌后刷新。',
    };
  }

  if (input.enabledProjectCount === 0) {
    return {
      kind: 'no-projects',
      message: '尚未启用任何 TAPD 项目。',
      hint: browserHint || '请到「设置」页读取并启用项目。',
    };
  }

  if (input.memberCount === 0) {
    return {
      kind: 'no-members',
      message: '尚未配置展示成员，任务会全部隐藏。',
      hint: browserHint || '请到「设置」页添加要展示的成员。',
    };
  }

  if (input.taskCount === 0) {
    return {
      kind: 'empty',
      message: '当前时间范围内没有可展示的任务。',
      hint: browserHint || '可切换月份，或确认所选项目的排期数据与成员配置。',
    };
  }

  return { kind: 'ready', message: '', hint: browserHint };
}
