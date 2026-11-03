<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'

type Project = { id: string; name: string; enabled: boolean; color: string; alias?: string; order?: number; available?: boolean }
type Member = { staffId: string; name: string; account?: string; enabled?: boolean; order?: number }
type Settings = {
  schemaVersion: number
  teamName: string
  timeZone: 'Asia/Shanghai' | 'UTC'
  projects: Project[]
  members: Member[]
  groups: Array<{id:string;name:string;memberIds:string[];testing?:boolean}>
  defaultGroupId: string
  currentUser?: Member
  hours: { dailyRequiredHours: number; exemptions: Array<{ staffId: string; date: string; hours: number; note: string }>; completedStates: Array<{ projectId: string; type: 'task' | 'bug'; values: string[] }> }
  chinaCalendar: { enabled: boolean; years: Record<string, unknown> }
  tapd: { baseUrl: string; workspaceIds: string[]; defaultTypes: Array<'task' | 'bug'>; writeAccess?: { workspaceIds: string[]; operations: Array<'create' | 'update'>; fields: string[] } }
  updatedAt: string
}
type Snapshot = { revision: number; settings: Settings; credentialPresent: boolean; importedFrom?: string; warning?: string }
type ToolResponse = { isError?: boolean; structuredContent?: unknown }

const app = new App({ name: 'TeamSight settings', version: '0.2.0' }, {}, { autoResize: true })
const settings = reactive<Settings>({
  schemaVersion: 5,
  teamName: '',
  timeZone: 'Asia/Shanghai',
  projects: [],
  members: [],
  groups: [{id: 'default', name: '默认分组', memberIds: []}],
  defaultGroupId: 'default',
  hours: { dailyRequiredHours: 8, exemptions: [], completedStates: [] },
  chinaCalendar: { enabled: false, years: {} },
  tapd: { baseUrl: 'https://api.tapd.cn', workspaceIds: [], defaultTypes: ['task', 'bug'], writeAccess: { workspaceIds: [], operations: [], fields: [] } },
  updatedAt: '',
})
const revision = ref(0)
const credentialPresent = ref(false)
const tapdToken = ref('')
const legacyJson = ref('')
const queryWorkspace = ref('')
const queryType = ref<'story' | 'task' | 'bug'>('task')
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
  settings.groups = (snapshot.settings.groups ?? []).map(group=>({...group,memberIds:[...group.memberIds]}))
  settings.hours = { ...snapshot.settings.hours, exemptions: [...snapshot.settings.hours.exemptions], completedStates: [...snapshot.settings.hours.completedStates] }
  settings.chinaCalendar = { ...snapshot.settings.chinaCalendar }
  settings.tapd = JSON.parse(JSON.stringify({ ...snapshot.settings.tapd, writeAccess: snapshot.settings.tapd.writeAccess ?? { workspaceIds: [], operations: [], fields: [] } }))
  revision.value = snapshot.revision
  credentialPresent.value = snapshot.credentialPresent
  if (!queryWorkspace.value) queryWorkspace.value = settings.tapd.workspaceIds[0] ?? settings.projects[0]?.id ?? ''
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({ name, arguments: JSON.parse(JSON.stringify(args)) }) as ToolResponse
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
    groups: settings.groups.map(group=>({...group,memberIds:[...group.memberIds]})),
    defaultGroupId: settings.defaultGroupId,
    hours: { ...settings.hours, exemptions: [...settings.hours.exemptions], completedStates: [...settings.hours.completedStates] },
    chinaCalendar: JSON.parse(JSON.stringify(settings.chinaCalendar)),
    tapd: { ...settings.tapd, workspaceIds: [...settings.tapd.workspaceIds].filter(Boolean), defaultTypes: [...settings.tapd.defaultTypes] },
  }
  const args: Record<string, unknown> = { expectedRevision: revision.value, patch }
  if (tapdToken.value) args.tapdToken = tapdToken.value
  copySnapshot(await call('teamsight_save_settings', args) as unknown as Snapshot)
  tapdToken.value = ''
  message.value = `已保存设置修订 ${revision.value}`
  await app.updateModelContext({content:[{type:'text',text:JSON.stringify({event:'teamsight_configuration_saved',credentialPresent:credentialPresent.value,currentUser:settings.currentUser,projects:settings.projects.filter(project=>project.enabled).map(project=>project.id)})}]}).catch(()=>{})
})

const importSettings = () => action(async () => {
  if (!legacyJson.value.trim()) throw new Error('请先粘贴旧 App 的 settings.json 内容')
  const imported = await call('teamsight_import_settings', { expectedRevision: revision.value, settingsJson: legacyJson.value, source: 'legacy-settings.json' })
  copySnapshot(imported as unknown as Snapshot)
  message.value = `已导入旧配置，修订 ${revision.value}${imported.ignoredCredential ? '；凭据字段已忽略，请单独填写 TAPD Token' : ''}`
  legacyJson.value = ''
})

const refreshYear = (year: number) => action(async () => { await call('teamsight_refresh_calendar', { year }); copySnapshot(await call('teamsight_read_settings') as unknown as Snapshot); message.value = `已刷新日历 ${year}` })

function addProject() { settings.projects.push({ id: '', name: '', enabled: true, color: '#3b82f6' }) }
function removeProject(index: number) { settings.projects.splice(index, 1) }
function addMember() { settings.members.push({ staffId: '', name: '', enabled:true, order:settings.members.length }) }
function removeMember(index: number) { const [member]=settings.members.splice(index,1);for(const group of settings.groups) group.memberIds=group.memberIds.filter(id=>id!==member.staffId) }
function move<T extends {order?:number}>(rows:T[],index:number,delta:number) {if(index+delta<0||index+delta>=rows.length)return;rows.splice(index+delta,0,rows.splice(index,1)[0]);rows.forEach((row,index)=>row.order=index)}
function addGroup() {settings.groups.push({id:'group-'+Date.now(),name:'新分组',memberIds:[]})}
function removeGroup(index:number) {if(settings.groups.length<2)return;const [group]=settings.groups.splice(index,1);if(settings.defaultGroupId===group.id)settings.defaultGroupId=settings.groups[0].id}
const memberQuery=ref('')
const memberCandidates=ref<Member[]>([])
const discoverMember=(selectedAccount?:string)=>action(async()=>{const result=await call('teamsight_resolve_members',{query:memberQuery.value,selectedAccount});memberCandidates.value=(result.candidates as Member[])??[];if(result.status==='resolved'){copySnapshot(await call('teamsight_read_settings') as unknown as Snapshot);message.value='已保存成员身份，尚未自动加入团队分组'}else message.value='请从候选中选择成员，或调整搜索条件'})
const syncProjects=()=>action(async()=>{copySnapshot(await call('teamsight_sync_projects') as unknown as Snapshot);message.value='已同步项目与当前用户；保留现有项目偏好'})
const continueRequest=()=>action(async()=>{await app.sendMessage({role:'user',content:[{type:'text',text:'TeamSight 配置已完成。请继续之前因配置阻断的读取请求；涉及写入时先读取最新数据并核对操作回执。'}]});message.value='已通知对话继续读取'})

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
      <span class="badge">MCP · 配置管理</span>
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
          <div class="section-title"><h2>项目配置</h2><button type="button" @click="syncProjects">同步项目与身份</button><button type="button" @click="addProject">添加项目</button></div>
          <p v-if="!settings.projects.length" class="muted">尚未配置项目；可在下方 TAPD 查询中直接输入 workspace ID。</p>
          <div v-for="(project, index) in settings.projects" :key="index" class="item-row">
            <input v-model="project.id" placeholder="workspace ID" aria-label="项目 ID" />
            <input v-model="project.name" placeholder="项目名称" aria-label="项目名称" />
            <input v-model="project.alias" placeholder="项目别名" aria-label="项目别名" /><button type="button" :disabled="index===0" @click="move(settings.projects,index,-1)">上移</button><button type="button" :disabled="index===settings.projects.length-1" @click="move(settings.projects,index,1)">下移</button><input v-model="project.color" type="color" aria-label="项目颜色" />
            <label class="inline"><input v-model="project.enabled" type="checkbox" />启用</label>
            <button type="button" @click="removeProject(index)">删除</button>
          </div>
        </section>

        <section>
          <div class="section-title"><h2>成员配置</h2><button type="button" @click="addMember">添加成员</button></div>
          <p v-if="!settings.members.length" class="muted">身份与默认团队分开保存；新成员需要手动加入分组。</p>
          <div v-for="(member, index) in settings.members" :key="index" class="item-row">
            <input v-model="member.staffId" placeholder="工号" aria-label="成员工号" />
            <input v-model="member.name" placeholder="姓名" aria-label="成员姓名" /><input v-model="member.account" placeholder="TAPD 完整账号" aria-label="成员账号" /><label class="inline"><input v-model="member.enabled" type="checkbox" />启用</label><button type="button" :disabled="index===0" @click="move(settings.members,index,-1)">上移</button><button type="button" :disabled="index===settings.members.length-1" @click="move(settings.members,index,1)">下移</button>
            <button type="button" @click="removeMember(index)">删除</button>
          </div>
        </section>

        <section>
          <h2>成员发现与分组</h2>
          <div class="buttons"><input v-model="memberQuery" placeholder="姓名、工号或完整账号" aria-label="搜索成员"><button type="button" @click="discoverMember()">查找成员</button></div>
          <button v-for="candidate in memberCandidates" :key="candidate.account" type="button" @click="discoverMember(candidate.account)">{{ candidate.name }} · {{ candidate.account }}</button>
          <label>默认团队分组<select v-model="settings.defaultGroupId"><option v-for="group in settings.groups" :key="group.id" :value="group.id">{{group.name}}</option></select></label>
          <div v-for="(group,index) in settings.groups" :key="group.id" class="group"><input v-model="group.name" aria-label="分组名称"><label class="inline"><input v-model="group.testing" type="checkbox">测试人员组</label><label v-for="member in settings.members" :key="member.staffId" class="inline"><input v-model="group.memberIds" type="checkbox" :value="member.staffId">{{member.name}}</label><button type="button" :disabled="settings.groups.length<2" @click="removeGroup(index)">删除分组</button></div>
          <button type="button" @click="addGroup">添加分组</button>
        </section>
        <section>
          <h2>TAPD 连接</h2>
          <p>当前用户：{{settings.currentUser?.name ?? '尚未解析'}} · {{settings.currentUser?.account ?? ''}}</p>
          <label>Base URL<input v-model="settings.tapd.baseUrl" type="url" required /></label>
          <label>Workspace IDs（逗号分隔）<input v-model="workspaceIdsText" placeholder="例如 12345678,87654321" /></label>
          <label>TAPD Token（留空则保持当前凭据）<input v-model="tapdToken" type="password" autocomplete="off" placeholder="不会回显已保存的 Token" /></label>
          <small>当前凭据：{{ credentialPresent ? '已配置' : '未配置' }}。保存后不会在设置读取、工具结果或 TeamSight 日志中返回明文。</small>
        </section>


        <section>
          <div class="section-title"><h2>按小时请假</h2><button type="button" @click="settings.hours.exemptions.push({ staffId: settings.members[0]?.staffId ?? '', date: '', hours: 8, note: '' })">添加请假</button></div>
          <div v-for="(leave,index) in settings.hours.exemptions" :key="index" class="row">
            <label>成员<select v-model="leave.staffId"><option v-for="member in settings.members" :key="member.staffId" :value="member.staffId">{{ member.name }}</option></select></label>
            <label>日期<input v-model="leave.date" type="date" required></label><label>请假小时<input v-model.number="leave.hours" type="number" min="0.1" max="24" step="0.5" required></label><label>备注<input v-model="leave.note"></label><button type="button" @click="settings.hours.exemptions.splice(index,1)">移除请假</button>
          </div>
          <small>工作日目标 = max(每日目标 − 请假小时, 0)。成员显示顺序以成员列表为准。</small>
        </section>
        <section>
          <div class="section-title"><h2>项目结束状态</h2><button type="button" @click="settings.hours.completedStates.push({ projectId: settings.projects[0]?.id ?? '', type: 'task', values: [] })">添加状态规则</button></div>
          <div v-for="(rule,index) in settings.hours.completedStates" :key="index" class="row"><label>项目<select v-model="rule.projectId"><option v-for="project in settings.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><label>类型<select v-model="rule.type"><option value="task">任务</option><option value="bug">缺陷</option></select></label><label>状态值（逗号分隔）<input :value="rule.values.join(', ')" @input="rule.values = ($event.target as HTMLInputElement).value.split(',').map(value => value.trim()).filter(Boolean)"></label><button type="button" @click="settings.hours.completedStates.splice(index,1)">移除规则</button></div>
        </section>
        <section>
          <h2>中国日历</h2><label class="inline"><input v-model="settings.chinaCalendar.enabled" type="checkbox">启用中国节假日与调休</label><small>已缓存年份永久复用，缺失年份由分析服务自动获取。点击年份可刷新已缓存数据。</small>
          <div class="buttons"><button v-for="year in Object.keys(settings.chinaCalendar.years)" :key="year" type="button" @click="refreshYear(Number(year))">刷新 {{ year }}</button></div>
        </section>
        <section v-if="settings.tapd.writeAccess">
          <h2>TAPD 写入范围</h2><small>保存范围后，工具仍会校验字段、身份、修改摘要和幂等键。创建与修改按项目单独开放。</small>
          <label>允许写入的项目 ID（逗号分隔）<input :value="settings.tapd.writeAccess.workspaceIds.join(', ')" @input="settings.tapd.writeAccess.workspaceIds = ($event.target as HTMLInputElement).value.split(',').map(value => value.trim()).filter(Boolean)"></label>
          <div class="buttons"><label class="inline"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="create">创建</label><label class="inline"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="update">修改</label></div>
          <label>允许写入的字段（逗号分隔）<input :value="settings.tapd.writeAccess.fields.join(', ')" placeholder="name, description, owner, begin, due, effort, status" @input="settings.tapd.writeAccess.fields = ($event.target as HTMLInputElement).value.split(',').map(value => value.trim()).filter(Boolean)"></label>
        </section>

        <section>
          <h2>旧配置导入</h2>
          <textarea v-model="legacyJson" rows="5" placeholder="粘贴旧 App 的 settings.json；Token 等凭据字段会被忽略"></textarea>
          <button type="button" @click="importSettings">导入旧配置</button>
        </section>

        <div class="buttons"><button type="submit">{{ busy ? '处理中…' : '保存设置' }}</button><button type="button" @click="reload">重新读取</button><button type="button" :disabled="!credentialPresent || !settings.currentUser" @click="continueRequest">继续原读取请求</button></div>
      </fieldset>
    </form>

    <section class="query" :class="{ disabled: !connected || busy }">
      <h2>TAPD 基础查询（只读）</h2>
      <div class="row">
        <label>Workspace ID<input v-model="queryWorkspace" placeholder="workspace ID" /></label>
        <label>类型<select v-model="queryType"><option value="story">需求</option><option value="task">任务</option><option value="bug">缺陷</option></select></label>
      </div>
      <div class="row"><label>关键词<input v-model="queryKeyword" placeholder="可选" /></label><label>工作项 ID<input v-model="queryId" placeholder="读取单项时填写" /></label></div>
      <div class="buttons"><button type="button" @click="listProjects">列出项目</button><button type="button" @click="searchItems">搜索工作项</button><button type="button" @click="readItem">读取工作项</button></div>
      <pre v-if="queryResult">{{ JSON.stringify(queryResult, null, 2) }}</pre>
    </section>

    <p role="status" :class="{ error: failed }">{{ message }}</p>
    <footer>设置修订 {{ revision }} · {{ settings.updatedAt ? `最近更新 ${settings.updatedAt}` : '等待读取' }} · 写入仅允许已保存的项目、操作和字段范围</footer>
  </main>
</template>

<style scoped>
:global(body){margin:0;color:#1c3044;background:#f4f7fa;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-size:14px}
main{max-width:760px;margin:auto;padding:24px}.badge{font-size:12px;color:#167d7f}h1{font-size:24px;margin:8px 0}h2{font-size:16px;margin:0 0 14px}header p,small,footer,.muted{color:#5d6d7a;line-height:1.6}section{margin-top:24px;padding-top:20px;border-top:1px solid #dbe4ea}fieldset{border:0;padding:0;margin:0}label{display:flex;flex-direction:column;gap:7px;margin:0 0 14px}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.item-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}.item-row input,.item-row button{min-width:0;max-width:180px}.group{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #dbe4ea;padding:12px;margin:10px 0}.inline{display:flex;flex-direction:row;align-items:center;margin:0;gap:5px;white-space:nowrap}input,select,textarea,button{font:inherit;border-radius:7px;padding:9px;border:1px solid #bdcbd8;background:white;min-width:0}textarea{width:100%;box-sizing:border-box;resize:vertical}input:focus,select:focus,textarea:focus{outline:2px solid #167d7f;outline-offset:2px}.section-title{display:flex;justify-content:space-between;align-items:center}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}button{cursor:pointer}button[type=submit]{background:#167d7f;color:white;border-color:#167d7f}:disabled,.disabled{cursor:default;opacity:.65}.query pre{max-height:320px;overflow:auto;background:#17232e;color:#e8f0f5;padding:12px;border-radius:7px;font-size:12px;white-space:pre-wrap;word-break:break-word}[role=status]{padding:12px;background:#e5f2ee;border-radius:7px}.error{background:#fce9e7!important;color:#922a24}footer{font-size:12px;margin-top:12px}@media(max-width:600px){main{padding:16px}.row{grid-template-columns:1fr;gap:0}.item-row{grid-template-columns:1fr 1fr auto}.item-row input[type=color]{width:48px}.inline{grid-column:1 / 2}.item-row button{grid-column:2 / 3;grid-row:2}}
</style>
