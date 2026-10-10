import { describe, expect, it } from 'vitest';

import { resolveBoardState, type BoardStateInput } from './boardState';

function input(partial: Partial<BoardStateInput> = {}): BoardStateInput {
  return {
    loading: false,
    fixtureMode: false,
    isDesktop: true,
    credentialConfigured: true,
    enabledProjectCount: 2,
    memberCount: 3,
    taskCount: 12,
    ...partial,
  };
}

describe('resolveBoardState', () => {
  it('数据齐备时进入 ready 且没有提示', () => {
    const state = resolveBoardState(input());
    expect(state.kind).toBe('ready');
    expect(state.message).toBe('');
  });

  it('按优先级返回：loading > fixture > 凭据 > 项目 > 成员 > 空数据', () => {
    expect(resolveBoardState(input({ loading: true, fixtureMode: true })).kind).toBe('loading');
    expect(resolveBoardState(input({ fixtureMode: true, credentialConfigured: false })).kind).toBe(
      'fixture'
    );
    expect(
      resolveBoardState(input({ credentialConfigured: false, enabledProjectCount: 0 })).kind
    ).toBe('no-credential');
    expect(resolveBoardState(input({ enabledProjectCount: 0, memberCount: 0 })).kind).toBe(
      'no-projects'
    );
    expect(resolveBoardState(input({ memberCount: 0, taskCount: 0 })).kind).toBe('no-members');
    expect(resolveBoardState(input({ taskCount: 0 })).kind).toBe('empty');
  });

  it('提示文案指向前置条件', () => {
    expect(resolveBoardState(input({ credentialConfigured: false })).hint).toContain('设置');
    expect(resolveBoardState(input({ enabledProjectCount: 0 })).message).toContain('启用');
    expect(resolveBoardState(input({ memberCount: 0 })).message).toContain('隐藏');
    expect(resolveBoardState(input({ taskCount: 0 })).message).toContain('没有可展示的任务');
  });

  it('浏览器环境补充说明无法直连 TAPD', () => {
    const state = resolveBoardState(input({ isDesktop: false, credentialConfigured: false }));
    expect(state.hint).toContain('浏览器模式无法直连 TAPD');
  });
});
