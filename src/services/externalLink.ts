import { isTauriRuntime } from './tapd/client';

/**
 * 打开外部链接。
 *
 * Tauri 的 webview 不会自行处理 `<a target="_blank">`，必须通过 opener 插件
 * 交给系统浏览器；浏览器模式保留原生新标签行为。
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) {
    throw new Error(`仅允许打开 https 链接：${url}`);
  }

  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
