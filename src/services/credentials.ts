import { isTauriRuntime, tauriTransport, type TapdTransport } from './tapd/client';
import type { TapdEnvelope } from './tapd/types';

/** 浏览器开发模式的令牌存储键（仅开发用途，技术方案 §4.3 禁止在生产中使用）。 */
export const DEV_TOKEN_STORAGE_KEY = 'teamsight.dev.token';

type CredentialSource = 'file' | 'env' | 'none' | 'browser';

export interface CredentialStatus {
  configured: boolean;
  source: CredentialSource;
  maskedHint: string | null;
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
  projectCount?: number;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function maskToken(token: string): string {
  const chars = [...token];
  if (chars.length <= 8) return '…';
  return `${chars.slice(0, 4).join('')}…${chars.slice(-4).join('')}`;
}

function readDevToken(): string | null {
  const token = window.localStorage.getItem(DEV_TOKEN_STORAGE_KEY);
  return token && token.trim() ? token : null;
}

/** 浏览器模式只做本地占位，桌面端才由 Rust 读写凭据文件。 */
export function isBrowserCredentialMode(): boolean {
  return !isTauriRuntime();
}

export async function loadCredentialStatus(): Promise<CredentialStatus> {
  if (isTauriRuntime()) {
    return invokeTauri<CredentialStatus>('credential_status');
  }
  const token = readDevToken();
  return token
    ? { configured: true, source: 'browser', maskedHint: maskToken(token) }
    : { configured: false, source: 'none', maskedHint: null };
}

export async function saveCredential(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('令牌不能为空');

  if (isTauriRuntime()) {
    await invokeTauri<void>('credential_set', { token: trimmed });
    return;
  }
  window.localStorage.setItem(DEV_TOKEN_STORAGE_KEY, trimmed);
}

export async function clearCredential(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri<void>('credential_delete');
    return;
  }
  window.localStorage.removeItem(DEV_TOKEN_STORAGE_KEY);
}

/** 连通性测试：先验证凭据，再确认能取到项目列表。 */
export async function testCredential(
  transport: TapdTransport = tauriTransport
): Promise<CredentialTestResult> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message:
        '浏览器模式无法直连 TAPD（预检不支持 Authorization 头），请使用 pnpm tauri:dev 在桌面端测试连接。',
    };
  }

  try {
    const auth = await transport('/quickstart/testauth', {});
    if (auth.status !== 1) {
      return { ok: false, message: `凭据校验失败：${auth.info || '未知错误'}` };
    }
    const projects: TapdEnvelope<unknown> = await transport(
      '/workspaces/user_participant_projects',
      {}
    );
    const count = Array.isArray(projects.data) ? projects.data.length : 0;
    return { ok: true, message: `连接正常，可访问 ${count} 个项目`, projectCount: count };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 把 TAPD 错误转成可执行的用户提示（阶段0 实测的状态码语义）。 */
export function describeTapdError(status: number, info: string, projectLabel?: string): string {
  const target = projectLabel ? `项目 ${projectLabel} ` : '';
  if (status === 422) return `凭据无效或缺少必要参数，请重新配置令牌（${info || '422'}）`;
  if (status === 403) return `${target}无访问权限，请确认令牌所属公司与项目匹配`;
  if (status === 0) return info || '当前不在桌面端运行环境，无法访问 TAPD';
  return `${target}请求失败（${status}）：${info || '未知错误'}`;
}
