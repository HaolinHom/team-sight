import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  DEV_TOKEN_STORAGE_KEY,
  clearCredential,
  describeTapdError,
  loadCredentialStatus,
  saveCredential,
  testCredential,
} from './credentials';

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
  it('令牌写入 localStorage 并只返回掩码', async () => {
    const storage = stubWindow(false);

    expect(await loadCredentialStatus()).toEqual({
      configured: false,
      source: 'none',
      maskedHint: null,
    });

    await saveCredential('0123456789abcdef');
    expect(storage.getItem(DEV_TOKEN_STORAGE_KEY)).toBe('0123456789abcdef');
    expect(await loadCredentialStatus()).toEqual({
      configured: true,
      source: 'browser',
      maskedHint: '0123…cdef',
    });

    await clearCredential();
    expect(storage.getItem(DEV_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('浏览器模式不发起真实连接，直接给出指引', async () => {
    stubWindow(false);
    const result = await testCredential();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('桌面端');
  });
});

describe('桌面端模式', () => {
  it('通过 Rust 命令读写凭据且不透传明文', async () => {
    stubWindow(true);
    invokeMock.mockResolvedValueOnce({
      configured: true,
      source: 'file',
      maskedHint: 'f9b7…cdef',
    });

    const status = await loadCredentialStatus();

    expect(invokeMock).toHaveBeenCalledWith('credential_status', undefined);
    expect(status.source).toBe('file');
    expect(status.maskedHint).toBe('f9b7…cdef');
    expect(JSON.stringify(status)).not.toContain('0123456789abcdef');
  });

  it('保存与删除调用对应命令', async () => {
    stubWindow(true);
    invokeMock.mockResolvedValue(undefined);

    await saveCredential('  token-value  ');
    expect(invokeMock).toHaveBeenCalledWith('credential_set', { token: 'token-value' });

    await clearCredential();
    expect(invokeMock).toHaveBeenCalledWith('credential_delete', undefined);
  });
});

describe('describeTapdError', () => {
  it('按状态码给出可执行提示', () => {
    expect(describeTapdError(422, 'invalid')).toContain('请重新配置令牌');
    expect(describeTapdError(403, 'no permission', '巨像销售中台产品线')).toContain('无访问权限');
    expect(describeTapdError(0, '')).toContain('桌面端');
    expect(describeTapdError(500, 'boom')).toContain('500');
  });
});
