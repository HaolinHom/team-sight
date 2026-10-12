// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import SettingsPage from './SettingsPage.vue';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'settings_read') return JSON.stringify({
      schemaVersion: 1, projects: [{ id: '1', name: '项目', enabled: true, color: '#3b82f6' }], members: [], updatedAt: '',
    });
    if (command === 'credential_status') return { configured: true, source: 'file', maskedHint: null };
    if (command === 'settings_write') throw new Error('磁盘写入失败');
  });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  invokeMock.mockReset();
});

describe('设置页保存失败', () => {
  it('项目启用失败时控件仍显示已保存状态并提示错误', async () => {
    const wrapper = mount(SettingsPage);
    await flushPromises();
    const checkbox = wrapper.get<HTMLInputElement>('input[aria-label="启用 项目"]');
    await checkbox.setValue(false);
    await flushPromises();
    expect(checkbox.element.checked).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('磁盘写入失败');
    expect(wrapper.text()).toContain('启用 1 个');
    wrapper.unmount();
  });

  it('项目颜色保存失败时恢复已保存颜色', async () => {
    const wrapper = mount(SettingsPage);
    await flushPromises();
    const color = wrapper.get<HTMLInputElement>('input[type="color"]');
    await color.setValue('#ff0000');
    await flushPromises();
    expect(color.element.value).toBe('#3b82f6');
    expect(wrapper.get('[role="alert"]').text()).toContain('保存配置失败');
    wrapper.unmount();
  });
});
