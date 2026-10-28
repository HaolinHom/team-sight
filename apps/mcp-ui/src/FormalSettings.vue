<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'

type Project = { id: string; name: string; enabled: boolean; color: string }
type Member = { staffId: string; name: string }
type Settings = {
  schemaVersion: number
  teamName: string
  timeZone: 'Asia/Shanghai' | 'UTC'
  projects: Project[]
  members: Member[]
  hours: { dailyRequiredHours: number; exemptions: unknown[]; completedStates: unknown[] }
  chinaCalendar: { enabled: boolean; years: Record<string, unknown> }
  tapd: { baseUrl: string; workspaceIds: string[]; defaultTypes: Array<'task' | 'bug'> }
  updatedAt: string
}
type Snapshot = { revision: number; settings: Settings; credentialPresent: boolean; importedFrom?: string; warning?: string }
type ToolResponse = { isError?: boolean; structuredContent?: unknown }

const app = new App({ name: 'TeamSight settings', version: '0.1.0-p1a' }, {}, { autoResize: true })
const settings = reactive<Settings>({
  schemaVersion: 4,
  teamName: '',
  timeZone: 'Asia/Shanghai',
  projects: [],
  members: [],
  hours: { dailyRequiredHours: 8, exemptions: [], completedStates: [] },
  chinaCalendar: { enabled: false, years: {} },
  tapd: { baseUrl: 'https://api.tapd.cn', workspaceIds: [], defaultTypes: ['task', 'bug'] },
  updatedAt: '',
})
const revision = ref(0)
const credentialPresent = ref(false)
const tapdToken = ref('')
const legacyJson = ref('')
const queryWorkspace = ref('')
const queryType = ref<'task' | 'bug'>('task')
const queryKeyword = ref('')
const queryId = ref('')
const queryResult = ref<unknown>(null)
const connected = ref(false)
const busy = ref(false)
const failed = ref(false)
const message = ref('正在连接宿主…')
const workspaceIdsText = computed({
  get: () => settings.tapd.workspaceIds.join(', '),
  set: (value: string) => { settings.tapd.workspaceIds = value.split(',').map(item => item.trim()).filter(Boolean) },
})

function copySnapshot(snapshot: Snapshot) {
  Object.assign(settings, snapshot.settings)
  settings.projects = snapshot.settings.projects.map(project => ({ ...project }))
  settings.members = snapshot.settings.members.map(member => ({ ...member }))
  settings.hours = { ...snapshot.settings.hours, exemptions: [...snapshot.settings.hours.exemptions], completedStates: [...snapshot.settings.hours.completedStates] }
  settings.chinaCalendar = { ...snapshot.settings.chinaCalendar }
  settings.tapd = { ...snapshot.settings.tapd, workspaceIds: [...snapshot.settings.tapd.workspaceIds], defaultTypes: [...snapshot.settings.tapd.defaultTypes] }
  revision.value = snapshot.revision
  credentialPresent.value = snapshot.credentialPresent
  if (!queryWorkspace.value) queryWorkspace.value = settings.tapd.workspaceIds[0] ?? settings.projects[0]?.id ?? ''
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({ name, arguments: args }) as ToolResponse
  const data = response.structuredContent as Record<string, unknown> | undefined
  if (!data) throw new Error('响应缺少结构化结果')
  if (response.isError) {
    const current = data.current as Snapshot | undefined
    if (data.code === 'REVISION_CONFLICT') throw new Error(`配置已被另一会话修改，当前修订 ${current?.revision ?? '未知'}；请先重新读取。`)
    throw new Error(`操作失败：${String(data.code ?? 'UNKNOWN')}`)
  }
  return data
}

async function action(fn: () => Promise<void>) {
  busy.value = true
  failed.value = false
  try { await fn() } catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : '调用失败，请重试' }
  finally { busy.value = false }
}

const reload = () => action(async () => {
  copySnapshot(await call('teamsight_read_settings') as unknown as Snapshot)
  message.value = `已读取设置修订 ${revision.value}`
})

const save = () => action(async () => {
  const patch = {
    teamName: settings.teamName,
    timeZone: settings.timeZone,
    projects: settings.projects.map(project => ({ ...project })),
    members: settings.members.map(member => ({ ...member })),
    hours: { ...settings.hours, exemptions: [...settings.hours.exemptions], completedStates: [...settings.hours.completedStates] },
    tapd: { ...settings.tapd, workspaceIds: [...settings.tapd.workspaceIds].filter(Boolean), defaultTypes: [...settings.tapd.defaultTypes] },
  }
  const args: Record<string, unknown> = { expectedRevision: revision.value, patch }
  if (tapdToken.value) args.tapdToken = tapdToken.value
  copySnapshot(await call('teamsight_save_settings', args) as unknown as Snapshot)
  tapdToken.value = ''
  message.value = `已保存设置修订 ${revision.value}`
})

const importSettings = () => action(async () => {
  if (!legacyJson.value.trim()) throw new Error('请先粘贴旧 App 的 settings.json 内容')
  const imported = await call('teamsight_import_settings', { expectedRevision: revision.value, settingsJson: legacyJson.value, source: 'legacy-settings.json' })
  copySnapshot(imported as unknown as Snapshot)
  message.value = `已导入旧配置，修订 ${revision.value}${imported.ignoredCredential ? '；凭据字段已忽略，请单独填写 TAPD Token' : ''}`
  legacyJson.value = ''
})

function addProject() { settings.projects.push({ id: '', name: '', enabled: true, color: '#3b82f6' }) }
function removeProject(index: number) { settings.projects.splice(index, 1) }
function addMember() { settings.members.push({ staffId: '', name: '' }) }
function removeMember(index: number) { settings.members.splice(index, 1) }

const listProjects = () => action(async () => {
  queryResult.value = await call('tapd_list_projects')
  message.value = '已读取 TAPD 可见项目（只读）'
})
const searchItems = () => action(async () => {
  if (!queryWorkspace.value.trim()) throw new Error('请输入 workspace ID')
  queryResult.value = await call('tapd_search_items', { workspaceId: queryWorkspace.value.trim(), entityType: queryType.value, keyword: queryKeyword.value || undefined, limit: 50 })
  message.value = '已完成 TAPD 基础查询（只读）'
})
const readItem = () => action(async () => {
  if (!queryWorkspace.value.trim() || !queryId.value.trim()) throw new Error('请输入 workspace ID 和工作项 ID')
  queryResult.value = await call('tapd_get_item', { workspaceId: queryWorkspace.value.trim(), entityType: queryType.value, id: queryId.value.trim() })
  message.value = '已读取 TAPD 工作项（只读）'
})

onMounted(async () => {
  await action(async () => {
    await app.connect(undefined, { timeout: 10000 })
    connected.value = true
    copySnapshot(await call('teamsight_read_settings') as unknown as Snapshot)
    message.value = `已连接 TeamSight · 修订 ${revision.value}`
  })
})
</script>

<template>
  <main>
    <header>
      <span class="badge">P1a · 正式设置</span>
      <h1>TeamSight 设置</h1>
      <p>配置保存在本地服务；TAPD Token 只写入系统凭据库，读取结果仅显示是否已配置。</p>
    </header>

    <form @submit.prevent="save">
      <fieldset :disabled="!connected || busy">
        <section>
          <h2>团队与工时</h2>
          <label>团队名称<input v-model="settings.teamName" required maxlength="80" /></label>
          <div class="row">
            <label>业务时区<select v-model="settings.timeZone"><option value="Asia/Shanghai">Asia/Shanghai</option><option value="UTC">UTC</option></select></label>
            <label>每日目标工时<input v-model.number="settings.hours.dailyRequiredHours" type="number" min="0" max="24" step="0.5" required /></label>
          </div>
        </section>

        <section>
          <div class="section-title"><h2>项目配置</h2><button type="button" @click="addProject">添加项目</button></div>
          <p v-if="!settings.projects.length" class="muted">尚未配置项目；可在下方 TAPD 查询中直接输入 workspace ID。</p>
          <div v-for="(project, index) in settings.projects" :key="index" class="item-row">
            <input v-model="project.id" placeholder="workspace ID" aria-label="项目 ID" />
            <input v-model="project.name" placeholder="项目名称" aria-label="项目名称" />
            <input v-model="project.color" type="color" aria-label="项目颜色" />
            <label class="inline"><input v-model="project.enabled" type="checkbox" />启用</label>
            <button type="button" @click="removeProject(index)">删除</button>
          </div>
        </section>

        <section>
          <div class="section-title"><h2>成员配置</h2><button type="button" @click="addMember">添加成员</button></div>
          <p v-if="!settings.members.length" class="muted">成员用于将 TAPD 工号映射为显示名称。</p>
          <div v-for="(member, index) in settings.members" :key="index" class="item-row">
            <input v-model="member.staffId" placeholder="工号" aria-label="成员工号" />
            <input v-model="member.name" placeholder="姓名" aria-label="成员姓名" />
            <button type="button" @click="removeMember(index)">删除</button>
          </div>
        </section>

        <section>
          <h2>TAPD 连接</h2>
          <label>Base URL<input v-model="settings.tapd.baseUrl" type="url" required /></label>
          <label>Workspace IDs（逗号分隔）<input v-model="workspaceIdsText" placeholder="例如 12345678,87654321" /></label>
          <label>TAPD Token（留空则保持当前凭据）<input v-model="tapdToken" type="password" autocomplete="off" placeholder="不会回显已保存的 Token" /></label>
          <small>当前凭据：{{ credentialPresent ? '已配置' : '未配置' }}。保存后不会在设置读取、工具结果或 TeamSight 日志中返回明文。</small>
        </section>

        <section>
          <h2>旧配置导入</h2>
          <textarea v-model="legacyJson" rows="5" placeholder="粘贴旧 App 的 settings.json；Token 等凭据字段会被忽略"></textarea>
          <button type="button" @click="importSettings">导入旧配置</button>
        </section>

        <div class="buttons"><button type="submit">{{ busy ? '处理中…' : '保存设置' }}</button><button type="button" @click="reload">重新读取</button></div>
      </fieldset>
    </form>

    <section class="query" :class="{ disabled: !connected || busy }">
      <h2>TAPD 基础查询（只读）</h2>
      <div class="row">
        <label>Workspace ID<input v-model="queryWorkspace" placeholder="workspace ID" /></label>
        <label>类型<select v-model="queryType"><option value="task">任务</option><option value="bug">缺陷</option></select></label>
      </div>
      <div class="row"><label>关键词<input v-model="queryKeyword" placeholder="可选" /></label><label>工作项 ID<input v-model="queryId" placeholder="读取单项时填写" /></label></div>
      <div class="buttons"><button type="button" @click="listProjects">列出项目</button><button type="button" @click="searchItems">搜索工作项</button><button type="button" @click="readItem">读取工作项</button></div>
      <pre v-if="queryResult">{{ JSON.stringify(queryResult, null, 2) }}</pre>
    </section>

    <p role="status" :class="{ error: failed }">{{ message }}</p>
    <footer>设置修订 {{ revision }} · {{ settings.updatedAt ? `最近更新 ${settings.updatedAt}` : '等待读取' }} · P1a 不执行 TAPD 写入</footer>
  </main>
</template>

<style scoped>
:global(body){margin:0;color:#1c3044;background:#f4f7fa;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-size:14px}
main{max-width:760px;margin:auto;padding:24px}.badge{font-size:12px;color:#167d7f}h1{font-size:24px;margin:8px 0}h2{font-size:16px;margin:0 0 14px}header p,small,footer,.muted{color:#5d6d7a;line-height:1.6}section{margin-top:24px;padding-top:20px;border-top:1px solid #dbe4ea}fieldset{border:0;padding:0;margin:0}label{display:flex;flex-direction:column;gap:7px;margin:0 0 14px}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.item-row{display:grid;grid-template-columns:1fr 1.3fr 48px auto auto;align-items:center;gap:8px;margin-bottom:8px}.item-row input,.item-row button{min-width:0}.inline{display:flex;flex-direction:row;align-items:center;margin:0;gap:5px;white-space:nowrap}input,select,textarea,button{font:inherit;border-radius:7px;padding:9px;border:1px solid #bdcbd8;background:white;min-width:0}textarea{width:100%;box-sizing:border-box;resize:vertical}input:focus,select:focus,textarea:focus{outline:2px solid #167d7f;outline-offset:2px}.section-title{display:flex;justify-content:space-between;align-items:center}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}button{cursor:pointer}button[type=submit]{background:#167d7f;color:white;border-color:#167d7f}:disabled,.disabled{cursor:default;opacity:.65}.query pre{max-height:320px;overflow:auto;background:#17232e;color:#e8f0f5;padding:12px;border-radius:7px;font-size:12px;white-space:pre-wrap;word-break:break-word}[role=status]{padding:12px;background:#e5f2ee;border-radius:7px}.error{background:#fce9e7!important;color:#922a24}footer{font-size:12px;margin-top:12px}@media(max-width:600px){main{padding:16px}.row{grid-template-columns:1fr;gap:0}.item-row{grid-template-columns:1fr 1fr auto}.item-row input[type=color]{width:48px}.inline{grid-column:1 / 2}.item-row button{grid-column:2 / 3;grid-row:2}}
</style>
