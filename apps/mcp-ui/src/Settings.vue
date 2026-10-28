<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'TeamSight P0 settings', version: '0.0.0-p0' }, {}, { autoResize: true })
type State = { revision: number; config: { teamName: string; dailyHours: number; timeZone: string }; credentialPresent: boolean }
const draft = reactive({ teamName: '', dailyHours: 8, timeZone: 'Asia/Shanghai' })
const revision = ref(0)
const credential = ref('')
const credentialPresent = ref(false)
const simulateFailure = ref(false)
const connected = ref(false)
const busy = ref(false)
const message = ref('正在连接宿主…')
const failed = ref(false)
function apply(state: State) {
  Object.assign(draft, state.config)
  revision.value = state.revision
  credentialPresent.value = state.credentialPresent
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({ name, arguments: args })
  const data = response.structuredContent as (State & { code?: string; current?: State; matches?: boolean }) | undefined
  if (!data) throw new Error('响应缺少结构化结果')
  if (response.isError) {
    const detail = data.code === 'REVISION_CONFLICT' ? `配置已被另一会话修改，当前修订 ${data.current?.revision}。请先重新读取再编辑。` : `保存失败：${data.code}。当前输入已保留，可重新提交。`
    throw new Error(detail)
  }
  return data
}
async function action(fn: () => Promise<void>) {
  busy.value = true; failed.value = false
  try { await fn() } catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : '调用失败，请重试' }
  finally { busy.value = false }
}
const reload = () => action(async () => { apply(await call('teamsight_probe_read_config')); message.value = `已读取修订 ${revision.value}` })
const save = () => action(async () => {
  const state = await call('teamsight_probe_save_config', { expectedRevision: revision.value, patch: { ...draft }, ...(credential.value ? { testCredential: credential.value } : {}), simulateFailure: simulateFailure.value })
  apply(state); credential.value = ''; message.value = `已保存，修订 ${revision.value}`
})
const checkCredential = () => action(async () => {
  const checked = await call('teamsight_probe_check_credential', { expected: credential.value })
  message.value = checked.matches ? '测试凭据一致' : '测试凭据不一致'
})
const clearCredential = () => action(async () => { apply(await call('teamsight_probe_clear_credential')); credential.value = ''; message.value = '测试凭据已清理' })
onMounted(async () => {
  await action(async () => {
    await app.connect(undefined, { timeout: 10000 })
    connected.value = true
    apply(await call('teamsight_probe_read_config'))
    message.value = `已连接 · 修订 ${revision.value}`
  })
})
</script>

<template>
  <main>
    <header><span class="badge">P0 · 原型</span><h1>TeamSight 配置验证</h1><p>配置保存在本地服务，界面通过宿主通信桥读取和提交。</p></header>
    <form @submit.prevent="save">
      <fieldset :disabled="!connected || busy">
        <label>团队名称<input v-model="draft.teamName" required maxlength="80" /></label>
        <div class="row"><label>每日目标（小时）<input v-model.number="draft.dailyHours" type="number" required min="0" max="24" step="0.5" /></label>
        <label>业务时区<select v-model="draft.timeZone"><option>Asia/Shanghai</option><option>UTC</option></select></label></div>
        <label>测试哨兵值<input v-model="credential" type="password" autocomplete="off" placeholder="TEAMSIGHT_P0_SENTINEL_…" pattern="TEAMSIGHT_P0_SENTINEL_[A-Za-z0-9_-]{1,80}" /></label>
        <small>仅填测试值，勿填真实 TAPD 凭据。宿主可能记录工具参数；P0 会核对其可见范围。已存测试凭据：{{ credentialPresent ? '有' : '无' }}。</small>
        <label class="check"><input v-model="simulateFailure" type="checkbox" />模拟保存失败（验证事务回滚）</label>
        <div class="buttons"><button type="submit">{{ busy ? '处理中…' : '保存配置' }}</button><button type="button" @click="reload">重新读取</button><button type="button" :disabled="!credential" @click="checkCredential">核对测试凭据</button><button type="button" @click="clearCredential">清理测试凭据</button></div>
      </fieldset>
    </form>
    <p role="status" :class="{ error: failed }">{{ message }}</p><footer>当前表单修订 {{ revision }} · 此原型不调用 TAPD</footer>
  </main>
</template>

<style scoped>
:global(body){margin:0;color:#1c3044;background:#f4f7fa;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-size:14px}main{max-width:640px;margin:auto;padding:24px}.badge{font-size:12px;color:#167d7f}h1{font-size:24px;margin:8px 0}header p,small,footer{color:#5d6d7a;line-height:1.6}fieldset{border:0;padding:0;margin-top:24px}label{display:flex;flex-direction:column;gap:7px;margin:0 0 16px}.row{display:grid;grid-template-columns:1fr 1fr;gap:18px}input,select,button{font:inherit;border-radius:7px;padding:10px;border:1px solid #bdcbd8;background:white;min-width:0}small{display:block}input:focus,select:focus{outline:2px solid #167d7f;outline-offset:2px}.check{flex-direction:row;align-items:center;margin-top:16px}.buttons{display:flex;gap:8px;flex-wrap:wrap}button{cursor:pointer}button[type=submit]{background:#167d7f;color:white;border-color:#167d7f}:disabled{cursor:default;opacity:.65}[role=status]{padding:12px;background:#e5f2ee;border-radius:7px}.error{background:#fce9e7!important;color:#922a24}footer{font-size:12px}@media(max-width:420px){main{padding:16px}.row{grid-template-columns:1fr;gap:0}}
</style>
