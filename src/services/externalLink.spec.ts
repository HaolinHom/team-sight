import { afterEach, describe, expect, it, vi } from 'vitest';

const openUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));

import { openExternalUrl } from './externalLink';

function stubWindow(tauri: boolean): { open: ReturnType<typeof vi.fn> } {
  const open = vi.fn();
  vi.stubGlobal('window', {
    open,
    ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
  });
  return { open };
}

const TAPD_URL = 'https://www.tapd.cn/tapd_fe/63253157/task/detail/9102';

afterEach(() => {
  vi.unstubAllGlobals();
  openUrlMock.mockReset();
});

describe('openExternalUrl', () => {
  it('桌面端交给 opener 插件（webview 不处理 target=_blank）', async () => {
    const { open } = stubWindow(true);
    openUrlMock.mockResolvedValueOnce(undefined);

    await openExternalUrl(TAPD_URL);

    expect(openUrlMock).toHaveBeenCalledWith(TAPD_URL);
    expect(open).not.toHaveBeenCalled();
  });

  it('浏览器模式打开新标签', async () => {
    const { open } = stubWindow(false);

    await openExternalUrl(TAPD_URL);

    expect(open).toHaveBeenCalledWith(TAPD_URL, '_blank', 'noopener,noreferrer');
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it('拒绝非 https 链接', async () => {
    stubWindow(true);
    await expect(openExternalUrl('file:///etc/passwd')).rejects.toThrow('仅允许打开 https 链接');
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it('插件报错时向上抛出，供界面提示', async () => {
    stubWindow(true);
    openUrlMock.mockRejectedValueOnce(new Error('URL not allowed on the configured scope'));
    await expect(openExternalUrl(TAPD_URL)).rejects.toThrow('URL not allowed');
  });
});
