import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { DEV_SETTINGS_STORAGE_KEY, loadSettings, saveSettings } from './settings';
import { createEmptySettings } from '@/types/settings';

function createFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  } as Storage;
}

function stubWindow(tauri: boolean): Storage {
  const localStorage = createFakeStorage();
  vi.stubGlobal('window', {
    localStorage,
    ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
  });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  invokeMock.mockReset();
});

describe('浏览器开发模式', () => {
  it('无本地数据时返回默认配置', async () => {
    stubWindow(false);
    const { settings, warning } = await loadSettings();
    expect(settings.projects).toEqual([]);
    expect(warning).toBeUndefined();
  });

  it('配置损坏时回退默认并提示', async () => {
    const storage = stubWindow(false);
    storage.setItem(DEV_SETTINGS_STORAGE_KEY, '{not-json');
    const { settings, warning } = await loadSettings();
    expect(settings.projects).toEqual([]);
    expect(warning).toContain('损坏');
  });

  it('保存后可从同一存储读回', async () => {
    const storage = stubWindow(false);
    const settings = createEmptySettings();
    settings.projects = [{ id: '1', name: 'A', enabled: true, color: '#3b82f6' }];

    await saveSettings(settings);

    const raw = storage.getItem(DEV_SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { settings: loaded } = await loadSettings();
    expect(loaded.projects).toEqual(settings.projects);
  });
});

describe('桌面端模式', () => {
  it('通过 Rust 命令读取与写入配置', async () => {
    stubWindow(true);
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 1,
        projects: [{ id: '63253157', name: '巨像销售中台产品线', enabled: true, color: '#10b981' }],
        members: [{ staffId: '800100001', name: '张三' }],
      })
    );

    const { settings } = await loadSettings();
    expect(invokeMock).toHaveBeenCalledWith('settings_read', undefined);
    expect(settings.projects[0].name).toBe('巨像销售中台产品线');
    expect(settings.members).toEqual([{ staffId: '800100001', name: '张三' }]);

    invokeMock.mockResolvedValueOnce(undefined);
    await saveSettings(settings);
    const [command, args] = invokeMock.mock.calls.at(-1) ?? [];
    expect(command).toBe('settings_write');
    expect(typeof (args as { settingsJson: string }).settingsJson).toBe('string');
  });

  it('读取命令异常时回退默认并提示', async () => {
    stubWindow(true);
    invokeMock.mockRejectedValueOnce(new Error('磁盘只读'));
    const { settings, warning } = await loadSettings();
    expect(settings.projects).toEqual([]);
    expect(warning).toContain('磁盘只读');
  });
});
