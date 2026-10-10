import { ref } from 'vue';

import {
  clearCredential,
  isBrowserCredentialMode,
  loadCredentialStatus,
  saveCredential,
  testCredential,
  type CredentialStatus,
} from '@/services/credentials';

const status = ref<CredentialStatus>({ configured: false, source: 'none', maskedHint: null });
const busy = ref(false);
const message = ref('');

export function useCredentials() {
  async function refresh(): Promise<void> {
    status.value = await loadCredentialStatus();
  }

  async function save(token: string): Promise<boolean> {
    busy.value = true;
    try {
      await saveCredential(token);
      await refresh();
      message.value = '令牌已保存';
      return true;
    } catch (error) {
      message.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function clear(): Promise<void> {
    busy.value = true;
    try {
      await clearCredential();
      await refresh();
      message.value = '令牌已清除';
    } catch (error) {
      message.value = `清除失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy.value = false;
    }
  }

  async function test(): Promise<string> {
    busy.value = true;
    message.value = '正在测试连接…';
    try {
      const result = await testCredential();
      message.value = result.message;
      return result.message;
    } finally {
      busy.value = false;
    }
  }

  return {
    status,
    busy,
    message,
    isBrowserMode: isBrowserCredentialMode(),
    refresh,
    save,
    clear,
    test,
  };
}
