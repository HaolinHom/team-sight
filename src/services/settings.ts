import { normalizeSettings, type AppSettings } from '@/types/settings';
import { isTauriRuntime } from './tapd/client';

/** 浏览器开发模式的本地存储键（仅开发用途，不进入生产路径）。 */
export const DEV_SETTINGS_STORAGE_KEY = 'teamsight.dev.settings.v1';

export interface LoadedSettings {
  settings: AppSettings;
  warning?: string;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/**
 * 读取配置。
 * - 桌面端：Tauri 应用配置目录下的 settings.json
 * - 浏览器：localStorage（仅开发模式）
 */
export async function loadSettings(): Promise<LoadedSettings> {
  let raw: string | null = null;
  let readError: string | undefined;

  try {
    if (isTauriRuntime()) {
      raw = await invokeTauri<string | null>('settings_read');
    } else {
      raw = window.localStorage.getItem(DEV_SETTINGS_STORAGE_KEY);
    }
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }

  if (readError) {
    const { settings } = normalizeSettings(null);
    return { settings, warning: `读取配置失败，已使用默认配置：${readError}` };
  }

  if (!raw) {
    const { settings } = normalizeSettings(null);
    return { settings };
  }

  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    const { settings } = normalizeSettings(null);
    return { settings, warning: '配置文件损坏，已回退默认配置' };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const payload: AppSettings = { ...settings, updatedAt: new Date().toISOString() };
  if (isTauriRuntime()) {
    await invokeTauri<void>('settings_write', { settingsJson: JSON.stringify(payload) });
    return;
  }
  window.localStorage.setItem(DEV_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}
