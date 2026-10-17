// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import SettingsPage from './SettingsPage.vue';
import { createEmptySettings } from '@/types/settings';

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

describe('项目名称编辑', () => {
  let saved = createEmptySettings();
  const writes = () => invokeMock.mock.calls.filter(([command]) => command === 'settings_write');
  beforeEach(() => {
    saved = createEmptySettings();
    saved.projects = [{ id: '1', name: '项目', enabled: true, color: '#3b82f6' }];
    invokeMock.mockImplementation(async (command: string, args?: { settingsJson: string }) => {
      if (command === 'settings_read') return JSON.stringify(saved);
      if (command === 'settings_write') saved = JSON.parse(args!.settingsJson);
      if (command === 'credential_status') return { configured: true, source: 'file', maskedHint: null };
    });
  });
  async function edit() {
    const wrapper = mount(SettingsPage);
    await flushPromises();
    await wrapper.get('[aria-label="编辑项目 1 的名称"]').trigger('click');
    return wrapper;
  }

  it('保存名称去除首尾空白，重新打开后保留且不改变项目身份', async () => {
    let wrapper = await edit();
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('  简称  ');
    await wrapper.get('.project-name-editor').trigger('submit'); await flushPromises();
    expect(wrapper.find('.project-name-editor').exists()).toBe(false);
    expect(saved.projects).toEqual([{ id: '1', name: '简称', enabled: true, color: '#3b82f6' }]);
    wrapper.unmount(); wrapper = await edit();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="项目 1 的名称"]').element.value).toBe('简称');
    wrapper.unmount();
  });

  it('取消、未变化和空白名称不写入，离开页面丢弃草稿', async () => {
    let wrapper = await edit();
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('   ');
    await wrapper.get('.project-name-editor').trigger('submit');
    expect(wrapper.get('.project-name-editor [role="alert"]').text()).toBe('项目名称不能为空');
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('  项目  ');
    await wrapper.get('.project-name-editor').trigger('submit'); await flushPromises();
    await wrapper.get('[aria-label="编辑项目 1 的名称"]').trigger('click');
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('草稿');
    await wrapper.findAll('.project-name-editor button')[1].trigger('click');
    expect(wrapper.text()).not.toContain('草稿');
    await wrapper.get('[aria-label="编辑项目 1 的名称"]').trigger('click');
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('未保存');
    wrapper.unmount(); wrapper = await edit();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="项目 1 的名称"]').element.value).toBe('项目');
    expect(writes()).toHaveLength(0); wrapper.unmount();
  });

  it('保存期间保持确认名称并禁用编辑，失败保留草稿可以重试', async () => {
    const wrapper = await edit();
    let fail!: (error: Error) => void;
    invokeMock.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    await wrapper.get('input[aria-label="项目 1 的名称"]').setValue('简称');
    await wrapper.get('.project-name-editor').trigger('submit'); await flushPromises();
    expect(saved.projects[0].name).toBe('项目');
    expect(wrapper.get<HTMLInputElement>('.project-name-editor input').element.disabled).toBe(true);
    expect(wrapper.findAll('.project-name-editor button').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true);
    fail(new Error('磁盘写入失败')); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('磁盘写入失败');
    expect(wrapper.get<HTMLInputElement>('.project-name-editor input').element.value).toBe('简称');
    await wrapper.get('.project-name-editor').trigger('submit'); await flushPromises();
    expect(saved.projects[0].name).toBe('简称');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false); wrapper.unmount();
  });
});

describe('展示成员排序', () => {
  let saved = createEmptySettings();
  const hitTestDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  beforeEach(() => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
    saved = createEmptySettings();
    saved.members = [{ staffId: '100', name: '张三' }, { staffId: '200', name: '李四' }, { staffId: '300', name: '王五' }];
    invokeMock.mockImplementation(async (command: string, args?: { settingsJson: string }) => {
      if (command === 'settings_read') return JSON.stringify(saved);
      if (command === 'settings_write') saved = JSON.parse(args!.settingsJson);
      if (command === 'credential_status') return { configured: true, source: 'file', maskedHint: null };
    });
  });
  afterEach(() => {
    if (hitTestDescriptor) Object.defineProperty(document, 'elementFromPoint', hitTestDescriptor);
    else Reflect.deleteProperty(document, 'elementFromPoint');
  });
  async function mountPage() {
    const wrapper = mount(SettingsPage);
    await flushPromises();
    for (const handle of wrapper.findAll('.member-order__handle')) {
      Object.defineProperties(handle.element, {
        setPointerCapture: { value: vi.fn() },
        hasPointerCapture: { value: () => true },
        releasePointerCapture: { value: vi.fn() },
      });
    }
    return wrapper;
  }
  const order = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.member-order .mono').map(item => item.text());
  const writes = () => invokeMock.mock.calls.filter(([command]) => command === 'settings_write');

  // jsdom 的 PointerEvent 继承 MouseEvent 属性，VTU trigger 无法覆盖只读的继承属性。
  async function pointer(handle: { element: Element }, type: string, init: MouseEventInit & { pointerId: number }) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    handle.element.dispatchEvent(event);
    await nextTick();
  }

  it('前移后移自动保存，首尾禁用，重新打开保留顺序', async () => {
    let wrapper = await mountPage();
    expect(wrapper.get<HTMLButtonElement>('button[aria-label="前移 张三"]').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('button[aria-label="后移 王五"]').element.disabled).toBe(true);
    await wrapper.get('button[aria-label="后移 张三"]').trigger('click');
    await flushPromises();
    expect(order(wrapper)).toEqual(['200', '100', '300']);
    await wrapper.get('button[aria-label="前移 王五"]').trigger('click');
    await flushPromises();
    expect(order(wrapper)).toEqual(['200', '300', '100']);
    expect(saved.members.map(member => member.staffId)).toEqual(['200', '300', '100']);
    wrapper.unmount();
    wrapper = await mountPage();
    expect(order(wrapper)).toEqual(['200', '300', '100']);
    wrapper.unmount();
  });

  it('拖拽向前和向后插入，展示对应插入位置', async () => {
    const wrapper = await mountPage();
    const handle = wrapper.get<HTMLElement>('[aria-label="拖动 王五"]');
    await pointer(handle, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    expect(handle.element.setPointerCapture).toHaveBeenCalledWith(1);
    const first = wrapper.findAll('.member-order__item')[0];
    vi.mocked(document.elementFromPoint).mockReturnValue(first.element);
    vi.spyOn(first.element, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 40 } as DOMRect);
    await pointer(handle, 'pointermove', { pointerId: 1, clientX: 20, clientY: 11 });
    expect(first.classes()).toContain('member-order__item--before');
    await pointer(handle, 'pointerup', { pointerId: 1, clientX: 20, clientY: 11 }); await flushPromises();
    expect(handle.element.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(order(wrapper)).toEqual(['300', '100', '200']);
    await pointer(handle, 'pointerdown', { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    const last = wrapper.findAll('.member-order__item')[2];
    vi.mocked(document.elementFromPoint).mockReturnValue(last.element);
    vi.spyOn(last.element, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 40 } as DOMRect);
    await pointer(handle, 'pointermove', { pointerId: 2, clientX: 20, clientY: 49 });
    expect(last.classes()).toContain('member-order__item--after');
    await pointer(handle, 'pointerup', { pointerId: 2, clientX: 20, clientY: 49 }); await flushPromises();
    expect(order(wrapper)).toEqual(['100', '200', '300']);
    expect(wrapper.find('.member-order__item--after').exists()).toBe(false);
    expect(writes()).toHaveLength(2);
    wrapper.unmount();
  });

  it('松开时根据实际目标位置提交，不依赖上一次移动的提示', async () => {
    const wrapper = await mountPage();
    const handle = wrapper.get('[aria-label="拖动 张三"]');
    await pointer(handle, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    const target = wrapper.findAll('.member-order__item')[2];
    vi.mocked(document.elementFromPoint).mockReturnValue(target.get('.member-order__name').element);
    vi.spyOn(target.element, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 40 } as DOMRect);
    await pointer(handle, 'pointermove', { pointerId: 1, clientX: 20, clientY: 11 });
    expect(target.classes()).toContain('member-order__item--before');
    await pointer(handle, 'pointerup', { pointerId: 1, clientX: 20, clientY: 49 });
    await flushPromises();
    expect(order(wrapper)).toEqual(['200', '300', '100']);
    expect(saved.members.map(member => member.staffId)).toEqual(['200', '300', '100']);
    wrapper.unmount();
  });

  it.each(['pointercancel', 'lostpointercapture', 'escape'])('%s取消拖拽后不保存且清理提示', async (reason) => {
    const wrapper = await mountPage();
    const handle = wrapper.get('[aria-label="拖动 张三"]');
    vi.mocked(document.elementFromPoint).mockReturnValue(wrapper.findAll('.member-order__item')[2].element);
    await pointer(handle, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    await pointer(handle, 'pointermove', { pointerId: 1, clientX: 20, clientY: 20 });
    if (reason === 'escape') await handle.trigger('keydown', { key: 'Escape' });
    else await pointer(handle, reason, { pointerId: 1 });
    expect(wrapper.find('.member-order__item--before').exists()).toBe(false);
    expect(wrapper.find('.member-order__item--after').exists()).toBe(false);
    await pointer(handle, 'pointerup', { pointerId: 1, clientX: 20, clientY: 20 });
    await flushPromises();
    expect(order(wrapper)).toEqual(['100', '200', '300']);
    expect(writes()).toHaveLength(0);
    wrapper.unmount();
  });

  it('点击、轻微移动、自身放置和列表外松开不保存，其他指针不能提交', async () => {
    const wrapper = await mountPage();
    const handle = wrapper.get('[aria-label="拖动 张三"]');
    const rows = wrapper.findAll('.member-order__item');
    for (const target of [rows[2].element, rows[0].element, null]) {
      vi.mocked(document.elementFromPoint).mockReturnValue(target);
      await pointer(handle, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      await pointer(handle, 'pointermove', { pointerId: 1, clientX: target === rows[2].element ? 11 : 30, clientY: 10 });
      await pointer(handle, 'pointerup', { pointerId: 1, clientX: 30, clientY: 10 });
    }
    vi.mocked(document.elementFromPoint).mockReturnValue(rows[2].element);
    await pointer(handle, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    await pointer(handle, 'pointermove', { pointerId: 2, clientX: 30, clientY: 30 });
    await pointer(handle, 'pointerup', { pointerId: 2, clientX: 30, clientY: 30 });
    wrapper.unmount(); await flushPromises();
    expect(writes()).toHaveLength(0);
  });

  it('保存期间禁用排序，成功前保持已确认顺序', async () => {
    const wrapper = await mountPage();
    let finish!: () => void;
    invokeMock.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await wrapper.get('button[aria-label="后移 张三"]').trigger('click');
    await flushPromises();
    expect(order(wrapper)).toEqual(['100', '200', '300']);
    expect(wrapper.findAll('.member-order__handle:disabled')).toHaveLength(3);
    expect(wrapper.findAll('.member-order button').filter(button => button.text() !== '移除').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true);
    finish(); await flushPromises();
    expect(order(wrapper)).toEqual(['200', '100', '300']);
    wrapper.unmount();
  });

  it('保存失败提示错误并保持原顺序，随后可以重试', async () => {
    const wrapper = await mountPage();
    invokeMock.mockRejectedValueOnce(new Error('磁盘写入失败'));
    await wrapper.get('button[aria-label="前移 王五"]').trigger('click'); await flushPromises();
    expect(order(wrapper)).toEqual(['100', '200', '300']);
    expect(wrapper.get('[role="alert"]').text()).toContain('磁盘写入失败');
    await wrapper.get('button[aria-label="前移 王五"]').trigger('click'); await flushPromises();
    expect(order(wrapper)).toEqual(['100', '300', '200']);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
