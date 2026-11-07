<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'
import { followHostTheme } from './host-theme'
import { categories, settingsTarget, settingsPatch, type SettingsTarget, type Settings, type Snapshot, type Member } from './settings-model'
import SettingIcon from './SettingIcon.vue'
import RemoveSetting from './RemoveSetting.vue'
import './theme.css'
import './settings-theme.css'

const app = new App({ name: 'TeamSight settings', version: '0.3.2' }, {}, { autoResize: true })
const settings = reactive<Settings>({ schemaVersion: 6, teamName: '', timeZone: 'Asia/Shanghai', projects: [], members: [], groups: [{ id:'default', name:'默认分组', memberIds:[] }], defaultGroupId:'default', hours:{dailyRequiredHours:8,completedStates:[]}, chinaCalendar:{enabled:false,years:{}},tapd:{baseUrl:'https://api.tapd.cn',defaultTypes:['task','bug'],writeAccess:{operations:[],fields:[]}},updatedAt:'' })
const formEl=ref<HTMLFormElement>()
const baseline = ref<Settings>(), revision = ref(0), credentialPresent = ref(false), tapdToken = ref('')
const target = ref<SettingsTarget | null>(null), fromOverview = ref(false), connected = ref(false), busy = ref(false), failed = ref(false), conflict = ref(false), message = ref('正在连接…')
const showToken=ref(false),newGroupId=ref('')
const colorPresets=['#EB732D','#2D7A78','#5175BB','#9A68A7','#BC7340','#6E8657']
const categorySections=[{title:'接入与团队',ids:['connection','projects','members','groups']},{title:'工时与日历',ids:['hours','calendar','completed']}]
const writeFields=[{id:'name',name:'任务名称'},{id:'description',name:'任务描述'},{id:'owner',name:'负责人'},{id:'effort',name:'预估工时'},{id:'begin',name:'开始日期'},{id:'due',name:'结束日期'},{id:'story_id',name:'关联需求'},{id:'status',name:'任务状态'}]
function stepHours(delta:number){const value=Number(settings.hours.dailyRequiredHours);settings.hours.dailyRequiredHours=Math.max(0,Math.min(24,(Number.isFinite(value)?value:8)+delta))}
const editing = ref<number | null>(null), memberQuery = ref(''), candidates = ref<Member[]>([])
const pendingAction = ref<null | (() => Promise<void>)>(null)
const dirty = computed(() => !!baseline.value && (Object.keys(settingsPatch(baseline.value,settings)).length > 0 || !!tapdToken.value))
watch(dirty,value=>{if(value&&!failed.value)message.value=''})
const title = computed(() => categories.find(item => item.id === target.value)?.title ?? 'TeamSight 设置')
const summary=(id:string)=>id==='connection'?(credentialPresent.value?'已配置':'待配置'):id==='projects'?settings.projects.filter(row=>row.enabled).length+' 个启用项目':id==='members'?settings.members.length+' 位已保存成员':id==='groups'?settings.groups.length+' 个分组':id==='hours'?settings.hours.dailyRequiredHours+'h / 日':id==='calendar'?(settings.chinaCalendar.enabled?'已启用':'未启用'):''
const description = computed(() => categories.find(item => item.id === target.value)?.description ?? '选择需要调整的配置')
const split = (value: string) => value.split(',').map(value=>value.trim()).filter(Boolean)
let disposed = false
function snapshot(value: Snapshot) {
  Object.assign(settings,JSON.parse(JSON.stringify(value.settings)))
  settings.tapd.writeAccess ??= {operations:[],fields:[]}
  baseline.value = JSON.parse(JSON.stringify(settings))
  revision.value = value.revision; credentialPresent.value = value.credentialPresent; conflict.value = false
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({name,arguments:JSON.parse(JSON.stringify(args))})
  const data = response.structuredContent as Record<string, unknown> | undefined
  if (!data) throw new Error('未收到有效结果，请重试。')
  if (response.isError) {
    if (data.code === 'REVISION_CONFLICT') { conflict.value = true; throw new Error('配置已在其他卡片或会话中更改。你的编辑已保留，请先重新读取最新配置再编辑。') }
    throw new Error('未能完成操作，请稍后重试。错误代码：'+String(data.code ?? 'UNKNOWN'))
  }
  return data
}
async function action(fn: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true; failed.value = false
  try { await fn(); return true } catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : '操作失败，请重试。'; return false }
  finally { busy.value = false }
}
function discard() { if (baseline.value) Object.assign(settings,JSON.parse(JSON.stringify(baseline.value))); tapdToken.value=''; editing.value=null;showToken.value=false }
function guard(fn: () => Promise<void>) { if (dirty.value) pendingAction.value=fn; else void fn() }
const reload = () => guard(async () => { await action(async()=>{snapshot(await call('teamsight_read_settings') as unknown as Snapshot);message.value='已读取最新配置。'}) })
async function save() {
  const form=formEl.value
  if(form&&!form.reportValidity())return false
  const unique=(values:string[])=>new Set(values).size===values.length
  if(settings.projects.some(row=>!row.id.trim()||!row.name.trim())||settings.members.some(row=>!row.staffId.trim()||!row.name.trim())||settings.groups.some(row=>!row.name.trim())||!unique(settings.projects.map(row=>row.id))||!unique(settings.members.map(row=>row.staffId))){failed.value=true;message.value='请补全项目、成员或分组信息。项目 ID 和成员工号不能重复。';return false}
  if (!baseline.value || !dirty.value) return true
  return action(async()=>{
    const data=await call('teamsight_save_settings',{expectedRevision:revision.value,patch:settingsPatch(baseline.value!,settings),...(tapdToken.value?{tapdToken:tapdToken.value}:{})})
    snapshot(data as unknown as Snapshot);tapdToken.value='';showToken.value=false;editing.value=null
    const bootstrap=data.bootstrap as {status?:string;currentUser?:string}|undefined
    const partial=bootstrap?.status==='partial'||bootstrap?.currentUser==='unresolved'
    message.value=partial?'令牌已保存，但身份与项目初始化尚未完成，请重试同步。':'已保存更改。'
    failed.value=partial
    const event={event:'teamsight_configuration_saved',target:target.value,credentialPresent:credentialPresent.value,bootstrapStatus:partial?'partial':'complete'}
    await app.updateModelContext({content:[{type:'text',text:JSON.stringify(event)}]}).catch(()=>{})
    if (!partial) await notifyContinue()
  })
}
async function resumePending(saveFirst: boolean) {
  const next=pendingAction.value
  if (saveFirst && !(await save())) return
  if (!saveFirst) discard()
  pendingAction.value=null
  await next?.()
}
function openCategory(value: SettingsTarget) { guard(async()=>{target.value=value;editing.value=null;showToken.value=false;message.value='';failed.value=false}) }
function move<T extends {order?:number}>(rows:T[],index:number,delta:number) {if(index+delta<0||index+delta>=rows.length)return;rows.splice(index+delta,0,rows.splice(index,1)[0]);rows.forEach((row,i)=>row.order=i);editing.value=null}
function focusEditor(){void nextTick(()=>formEl.value?.querySelector<HTMLInputElement>('.inline-editor input')?.focus())}
function addGroup(){const id='group-'+Date.now();settings.groups.push({id,name:'新分组',memberIds:[]});newGroupId.value=id;void nextTick(()=>formEl.value?.querySelector<HTMLInputElement>('[data-group-id="'+id+'"] input')?.focus())}
function addProject() {settings.projects.push({id:'',name:'新项目',color:'#eb732d',enabled:true,order:settings.projects.length});editing.value=settings.projects.length-1;focusEditor()}
function removeMember(index:number) {const [member]=settings.members.splice(index,1);for(const group of settings.groups)group.memberIds=group.memberIds.filter(id=>id!==member.staffId)}
function addMember() {settings.members.push({staffId:'',name:'新成员',account:'',enabled:true,order:settings.members.length});editing.value=settings.members.length-1;focusEditor()}
function removeGroup(index:number) {if(settings.groups.length<2)return;const [group]=settings.groups.splice(index,1);if(settings.defaultGroupId===group.id)settings.defaultGroupId=settings.groups[0].id}
const syncProjects=()=>guard(async()=>{await action(async()=>{const data=await call('teamsight_sync_projects');snapshot(data as unknown as Snapshot);const ready=(data.bootstrap as {currentUser?:string}|undefined)?.currentUser==='complete';failed.value=!ready;message.value=ready?'已同步项目与当前用户，原有项目偏好已保留。':'项目已同步，当前用户身份尚未确认，请在对话中协助解析。';if(ready)await notifyContinue()})})
const discover=(account?:string)=>guard(async()=>{await action(async()=>{const data=await call('teamsight_resolve_members',{query:memberQuery.value,selectedAccount:account});candidates.value=(data.candidates as Member[])??[];if(data.status==='resolved'){snapshot(await call('teamsight_read_settings') as unknown as Snapshot);candidates.value=[];message.value='已保存成员身份，尚未加入任何团队分组。'}else message.value='请选择匹配的成员。'})})
const refreshYear=(year:number)=>guard(async()=>{await action(async()=>{await call('teamsight_refresh_calendar',{year});snapshot(await call('teamsight_read_settings') as unknown as Snapshot);message.value='日历已刷新。'})})
const continuation=ref(false),continuationSent=ref(false)
async function notifyContinue() {
  if(!continuation.value||continuationSent.value||!credentialPresent.value||!settings.currentUser)return
  try {await app.sendMessage({role:'user',content:[{type:'text',text:'TeamSight 配置已完成，请继续之前因配置阻断的读取请求。'}]});continuationSent.value=true;message.value+=' 已通知对话继续读取。'} catch {message.value+=' 请在对话中继续原请求。'}
}
onMounted(async()=>{
  app.ontoolinput=({arguments:args})=>{target.value=settingsTarget(args?.target);fromOverview.value=target.value==='overview';continuation.value=args?.continueRead===true}
  app.ontoolresult=result=>{const data=result.structuredContent as Record<string,unknown>|undefined;if(data?.target!==undefined){target.value=settingsTarget(data.target);fromOverview.value=target.value==='overview';continuation.value=data.continueRead===true}else if(target.value===null&&data?.settings){target.value='overview';fromOverview.value=true}}
  await action(async()=>{await app.connect(undefined,{timeout:10000});if(disposed)return;followHostTheme(app);snapshot(await call('teamsight_read_settings') as unknown as Snapshot);connected.value=true;message.value=''})
})
onUnmounted(()=>{disposed=true;tapdToken.value=''})
</script>

<template>
 <main class="settings-card" :aria-busy="busy">
  <header class="page-header">
   <div class="heading"><span class="heading-icon"><SettingIcon :name="target==='overview'||!target?'general':target"/></span><div><h1>{{title}}</h1><p>{{description}}</p></div></div>
   <button v-if="fromOverview&&target!=='overview'" class="back-button" type="button" :disabled="busy" @click="openCategory('overview')"><SettingIcon name="back"/>返回分类</button>
   <span v-else-if="target==='overview'&&settings.currentUser" class="current-user"><span class="avatar" aria-hidden="true">{{settings.currentUser.name.slice(0,1)}}</span>{{settings.currentUser.name}}</span>
  </header>
  <p v-if="!connected||target===null" role="status" class="loading-state">{{failed?message:'正在读取配置…'}}</p>
  <template v-if="connected&&target!==null">
   <div v-if="target==='overview'" class="categories">
    <section v-for="section in categorySections" :key="section.title" class="category-section"><h2>{{section.title}}</h2><button v-for="item in categories.filter(item=>section.ids.includes(item.id))" :key="item.id" class="category-row" @click="openCategory(item.id)"><span class="category-icon"><SettingIcon :name="item.id"/></span><span class="category-name"><strong>{{item.title}}</strong><small>{{item.description}}</small></span><span v-if="summary(item.id)" class="category-status" :class="{'needs-setup':item.id==='connection'&&!credentialPresent}">{{summary(item.id)}}</span><SettingIcon name="chevron"/></button></section>
   </div>
   <form v-else ref="formEl" @submit.prevent="save">
    <fieldset :disabled="busy">
     <section v-if="target==='connection'" class="form-section">
      <h2 class="connection-heading">账号连接</h2>
      <div class="identity-strip"><span class="connection-mark"><SettingIcon :name="credentialPresent?'check':'lock'"/></span><div><strong>{{credentialPresent?'个人令牌已配置':'连接你的 TAPD 账号'}}</strong><p>{{settings.currentUser?'当前用户：'+settings.currentUser.name:'保存令牌后，自动识别当前用户并同步项目。'}}</p></div><span class="status-badge" :class="{success:credentialPresent}">{{credentialPresent?'已配置':'待配置'}}</span></div>
      <div class="field-row"><label for="tapd-token">个人令牌<small>用于访问你有权限的 TAPD 数据</small></label><div class="field-control"><div class="input-action"><input id="tapd-token" v-model="tapdToken" :type="showToken?'text':'password'" autocomplete="off" :placeholder="credentialPresent?'输入新令牌以替换':'输入 TAPD personal_token'" :required="!credentialPresent"><button type="button" :aria-pressed="showToken" :disabled="!tapdToken" @click="showToken=!showToken">{{showToken?'隐藏':'显示'}}</button></div><small>令牌保存在系统凭据库，已保存的内容不会回显。</small></div></div>
      <div v-if="credentialPresent" class="quiet-action"><span>账号或项目未识别完整？</span><button type="button" class="text-button" @click="syncProjects"><SettingIcon name="refresh"/>重新同步</button></div>
      <details class="advanced"><summary>高级连接设置</summary><div class="field-row"><label for="api-address">API 地址</label><div class="field-control"><input id="api-address" v-model="settings.tapd.baseUrl" type="url" required></div></div></details>

      <div class="connection-group"><h2>查询内容</h2><div class="field-row"><span class="field-label">查询工作项类型</span><div class="field-control horizontal-choices"><label class="choice-option"><input v-model="settings.tapd.defaultTypes" type="checkbox" value="task">任务</label><label class="choice-option"><input v-model="settings.tapd.defaultTypes" type="checkbox" value="bug">缺陷</label></div></div></div>
      <div v-if="settings.tapd.writeAccess" class="connection-group"><h2>写入权限</h2><p class="inline-note">已启用且可访问的项目允许写入，仍需勾选允许的操作和字段。</p>
      <div class="subsection"><h3>允许的操作</h3><div class="operation-options"><label class="operation-option"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="create"><span><strong>创建任务</strong><small>根据拆解结果创建 TAPD 工作项</small></span></label><label class="operation-option"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="update"><span><strong>修改任务</strong><small>更新已有工作项的授权字段</small></span></label></div></div>
      <div class="subsection"><h3>允许修改的字段</h3><div class="field-options"><label v-for="field in writeFields" :key="field.id" class="choice-option"><input v-model="settings.tapd.writeAccess.fields" type="checkbox" :value="field.id"><span>{{field.name}}</span></label></div></div>
      <details class="advanced"><summary>高级字段设置</summary><label class="stack-field">字段列表<input :value="settings.tapd.writeAccess.fields.join(', ')" @input="settings.tapd.writeAccess.fields=split(($event.target as HTMLInputElement).value)"><small>包含上述已选字段及自定义字段名。</small></label></details>
      </div>
     </section>
     <section v-if="target==='projects'" class="form-section">
      <div class="section-toolbar"><p>{{settings.projects.length}} 个项目<span class="count-separator"></span>{{settings.projects.filter(p=>p.enabled).length}} 个已启用</p><div class="toolbar-actions"><button type="button" class="secondary" @click="syncProjects"><SettingIcon name="refresh"/>同步项目</button><button type="button" class="secondary" @click="addProject"><SettingIcon name="plus"/>添加项目</button></div></div>
      <p class="inline-note">同步后立即更新列表，已有的别名、颜色和启停设置会保留。启用项目同时用于默认查询和写入范围。</p>
      <div v-if="!settings.projects.length" class="empty-state"><SettingIcon name="projects"/><h2>还没有项目</h2><p>同步你有权限的 TAPD 项目，或手动添加。</p></div>
      <div v-else class="directory"><div class="directory-head project-columns"><span>项目</span><span>查询与写入</span><span class="right-label">操作</span></div>
       <article v-for="(project,index) in settings.projects" :key="index" class="directory-item" :class="{expanded:editing===index}">
        <div class="directory-row project-columns"><div class="project-identity"><span class="project-swatch" :style="{background:project.color}"></span><div><strong>{{project.alias||project.name||'新项目'}}</strong><p>{{project.alias?project.name:project.id||'待填写项目 ID'}}<span v-if="project.available===false" class="unavailable">暂不可访问</span></p></div></div><label class="toggle"><input v-model="project.enabled" type="checkbox" role="switch" :aria-label="project.name+' 启用'"><span>{{project.enabled?'已启用':'已停用'}}</span></label><div class="row-actions"><button type="button" class="edit-button" :aria-expanded="editing===index" @click="editing=editing===index?null:index"><SettingIcon :name="editing===index?'up':'edit'"/><span>{{editing===index?'收起':'编辑'}}</span></button><div class="reorder"><button type="button" aria-label="项目上移" :title="project.name+' 上移'" :disabled="index===0" @click="move(settings.projects,index,-1)"><SettingIcon name="up"/></button><button type="button" aria-label="项目下移" :title="project.name+' 下移'" :disabled="index===settings.projects.length-1" @click="move(settings.projects,index,1)"><SettingIcon name="down"/></button></div></div></div>
        <div v-if="editing===index" class="inline-editor"><div class="editor-grid"><label>项目名称<input v-model="project.name" required></label><label>显示别名<input v-model="project.alias" placeholder="未设置时显示项目名称"></label><label>项目 ID<input v-model="project.id" required></label><div class="color-field"><span class="control-label">项目颜色</span><div class="color-options"><label class="custom-color" :style="{background:project.color}"><input v-model="project.color" type="color" aria-label="自定义项目颜色"></label><button v-for="color in colorPresets" :key="color" type="button" class="color-option" :style="{background:color}" :aria-label="'项目颜色 '+color" :aria-pressed="project.color.toLowerCase()===color.toLowerCase()" @click="project.color=color"><SettingIcon v-if="project.color.toLowerCase()===color.toLowerCase()" name="check"/></button></div></div></div><RemoveSetting label="删除项目" description="仅从本地项目列表移除，保存更改后生效，不会删除 TAPD 项目。" @remove="settings.projects.splice(index,1);editing=null"/></div>
       </article>
      </div>
     </section>
     <section v-if="target==='members'" class="form-section">
      <div class="member-discovery"><label for="member-query">从 TAPD 查找成员</label><div class="search"><SettingIcon name="search"/><input id="member-query" v-model="memberQuery" aria-label="查找成员" placeholder="输入姓名、工号或完整账号" @keydown.enter.prevent="memberQuery.trim()&&discover()"><button type="button" class="secondary" :disabled="!memberQuery.trim()" @click="discover()">查找成员</button></div><small>选定后立即保存身份，加入团队需在分组配置中操作。</small></div>
      <div v-if="candidates.length" class="candidates"><p>请选择要保存的成员</p><button v-for="member in candidates" :key="member.account" type="button" @click="discover(member.account)"><span class="avatar" aria-hidden="true">{{member.name.slice(0,1)}}</span><span><strong>{{member.name}}</strong><small>{{member.account}}</small></span><SettingIcon name="plus"/></button></div>
      <div class="section-toolbar"><p>已保存成员 <strong>{{settings.members.length}}</strong></p><button type="button" class="text-button" @click="addMember"><SettingIcon name="plus"/>手动添加成员</button></div>
      <div v-if="!settings.members.length" class="empty-state"><SettingIcon name="members"/><h2>先找到一起工作的成员</h2><p>保存身份后，可在分组配置中组成团队。</p></div>
      <div v-else class="directory"><div class="directory-head project-columns"><span>成员</span><span>查询状态</span><span class="right-label">操作</span></div><article v-for="(member,index) in settings.members" :key="index" class="directory-item" :class="{expanded:editing===index}"><div class="directory-row project-columns"><div class="member-identity"><span class="avatar" aria-hidden="true">{{member.name.slice(0,1)||'人'}}</span><div><strong>{{member.name||'新成员'}}</strong><p>{{member.account||member.staffId||'待填写身份'}}</p><div class="tags"><span v-for="group in settings.groups.filter(g=>g.memberIds.includes(member.staffId))" :key="group.id">{{group.name}}</span><span v-if="!settings.groups.some(g=>g.memberIds.includes(member.staffId))" class="ungrouped">未分组</span></div></div></div><label class="toggle"><input :checked="member.enabled!==false" type="checkbox" role="switch" @change="member.enabled=($event.target as HTMLInputElement).checked" :aria-label="member.name+' 启用'"><span>{{member.enabled!==false?'已启用':'已停用'}}</span></label><div class="row-actions"><button type="button" class="edit-button" :aria-expanded="editing===index" @click="editing=editing===index?null:index"><SettingIcon :name="editing===index?'up':'edit'"/><span>{{editing===index?'收起':'编辑'}}</span></button><div class="reorder"><button type="button" aria-label="成员上移" :title="member.name+' 上移'" :disabled="index===0" @click="move(settings.members,index,-1)"><SettingIcon name="up"/></button><button type="button" aria-label="成员下移" :title="member.name+' 下移'" :disabled="index===settings.members.length-1" @click="move(settings.members,index,1)"><SettingIcon name="down"/></button></div></div></div><div v-if="editing===index" class="inline-editor"><div class="editor-grid"><label>姓名<input v-model="member.name" required></label><label>工号<input v-model="member.staffId" required></label><label class="span-two">完整账号<input v-model="member.account" placeholder="TAPD 中的完整账号"></label></div><RemoveSetting label="删除本地成员" description="保存后移除该成员的本地身份及分组关联，不影响 TAPD 账号和任务。" @remove="removeMember(index);editing=null"/></div></article></div>
     </section>
     <section v-if="target==='groups'" class="form-section">
      <div class="field-row compact"><label for="default-group">默认团队<small>对话未指定成员时使用这个分组</small></label><div class="field-control"><select id="default-group" v-model="settings.defaultGroupId"><option v-for="group in settings.groups" :key="group.id" :value="group.id">{{group.name}}</option></select></div></div>
      <p class="inline-note">一个成员可以加入多个分组，统计时会自动去重。</p>
      <div class="group-list"><details v-for="(group,index) in settings.groups" :key="group.id" class="group-panel" :data-group-id="group.id" :open="index===0||group.id===newGroupId"><summary><span class="group-symbol"><SettingIcon name="groups"/></span><span class="group-name"><strong>{{group.name||'新分组'}}</strong><span class="tags"><span v-if="settings.defaultGroupId===group.id" class="orange-tag">默认团队</span><span v-if="group.testing">测试人员</span></span></span><span class="member-count">{{group.memberIds.length}} 人</span><SettingIcon name="down"/></summary><div class="group-editor"><div class="editor-grid"><label>分组名称<input v-model="group.name" required></label><label class="toggle testing-toggle"><input v-model="group.testing" type="checkbox" role="switch"><span>测试人员组<small>用于识别测试任务负责人</small></span></label></div><div class="members-label"><span>分组成员</span><small>已选 {{group.memberIds.length}} 人</small></div><div class="member-options"><label v-for="member in settings.members" :key="member.staffId" class="choice-member" :class="{selected:group.memberIds.includes(member.staffId)}"><input v-model="group.memberIds" type="checkbox" :value="member.staffId"><span class="avatar small-avatar" aria-hidden="true">{{member.name.slice(0,1)}}</span><span>{{member.name}}</span></label></div><p v-if="!settings.members.length" class="inline-note">尚无可选成员，请先在成员配置中添加。</p><RemoveSetting label="删除分组" description="保存后移除分组，成员身份仍会保留。若删除默认组，将使用第一个剩余分组。" :disabled="settings.groups.length<2" @remove="removeGroup(index)"/></div></details></div><button type="button" class="add-row" @click="addGroup"><SettingIcon name="plus"/>添加分组</button>
     </section>
     <section v-if="target==='hours'" class="form-section">
      <div class="field-row"><label for="daily-hours">每日规定工时<small>同时用于工时目标和排期容量</small></label><div class="field-control"><div class="number-stepper"><button type="button" aria-label="减少每日规定工时" :disabled="settings.hours.dailyRequiredHours<=0" @click="stepHours(-.5)">−</button><input id="daily-hours" v-model.number="settings.hours.dailyRequiredHours" type="number" min="0" max="24" step="0.5" required><span>小时 / 天</span><button type="button" aria-label="增加每日规定工时" :disabled="settings.hours.dailyRequiredHours>=24" @click="stepHours(.5)">+</button></div><small>以 0.5 小时为步长，也可直接输入。</small></div></div>
      <div class="field-row"><label for="business-zone">业务时区<small>决定“今天”和工时记录的日期</small></label><div class="field-control"><select id="business-zone" v-model="settings.timeZone"><option value="Asia/Shanghai">中国标准时间（UTC+8）</option><option value="UTC">协调世界时（UTC）</option></select></div></div>
      <div class="rule-explainer"><SettingIcon name="info"/><p>工作日以每日规定工时为目标；按节假日与调休日历调整当天目标。</p></div>
     </section>
     <section v-if="target==='calendar'" class="form-section">
      <div class="preference-row"><div><h2>中国节假日与调休</h2><p>法定节假日不安排工时，调休工作日正常计算。</p></div><label class="toggle"><input v-model="settings.chinaCalendar.enabled" type="checkbox" role="switch" aria-label="启用中国节假日与调休"><span>{{settings.chinaCalendar.enabled?'已启用':'未启用'}}</span></label></div>
      <div class="subsection"><h2>日历数据</h2><p class="inline-note">已有年份会保留，缺少的年份在分析时自动获取。刷新立即生效。</p><div class="year-list"><div v-for="year in Object.keys(settings.chinaCalendar.years)" :key="year"><span><SettingIcon name="calendar"/>{{year}} 年</span><button type="button" class="text-button" @click="refreshYear(Number(year))"><SettingIcon name="refresh"/>刷新数据</button></div><p v-if="!Object.keys(settings.chinaCalendar.years).length" class="quiet-empty">还没有缓存年份，首次分析时自动获取。</p></div></div>
     </section>
     <section v-if="target==='completed'" class="form-section">
      <div class="section-toolbar"><p>按项目识别任务的完成状态</p><button type="button" class="secondary" :disabled="!settings.projects.length" @click="settings.hours.completedStates.push({projectId:settings.projects[0]?.id??'',type:'task',values:[]})"><SettingIcon name="plus"/>添加状态规则</button></div>
      <div v-if="!settings.hours.completedStates.length" class="empty-state"><SettingIcon name="completed"/><h2>暂无自定义完成状态</h2><p>为项目填写被视为已完成的任务或缺陷状态值。</p></div>
      <article v-for="(rule,index) in settings.hours.completedStates" :key="index" class="record-editor"><div class="editor-grid"><label>项目<select v-model="rule.projectId" required><option v-for="project in settings.projects" :key="project.id" :value="project.id">{{project.alias||project.name}}</option></select></label><label>工作项类型<select v-model="rule.type"><option value="task">任务</option><option value="bug">缺陷</option></select></label><label class="span-two">完成状态值<input :value="rule.values.join(', ')" placeholder="多个值以英文逗号分隔" @input="rule.values=split(($event.target as HTMLInputElement).value)"><small>填写 TAPD 项目中的实际状态值。</small></label></div><RemoveSetting label="移除规则" description="保存后移除这条完成状态规则。" @remove="settings.hours.completedStates.splice(index,1)"/></article>
     </section>
     <div v-if="message&&!pendingAction" class="feedback" :class="{failure:failed}" :role="failed?'alert':'status'"><SettingIcon :name="failed?'info':'check'"/><span>{{message}}</span><button v-if="conflict" type="button" @click="reload">重新读取</button></div>
     <footer class="save-bar"><span class="save-state"><span v-if="dirty" class="draft-dot"></span><SettingIcon v-else name="check"/>{{dirty?'有未保存的更改':'所有更改已保存'}}</span><div class="save-actions"><button type="button" class="secondary" :disabled="!dirty" @click="discard">取消</button><button class="primary" type="button" :disabled="!dirty||conflict" @click="save">{{busy?'保存中…':'保存更改'}}</button></div></footer>
    </fieldset>
   </form>
   <section v-if="pendingAction" class="draft-guard" aria-label="未保存更改" role="alertdialog" aria-modal="false"><SettingIcon name="info"/><div><h2>先处理未保存的更改</h2><p>保存或放弃当前编辑后，再继续操作。</p><div class="guard-actions"><button type="button" class="primary" :disabled="busy||conflict" @click="resumePending(true)">保存后继续</button><button type="button" :disabled="busy" @click="resumePending(false)">放弃后继续</button><button type="button" class="text-button" :disabled="busy" @click="pendingAction=null">返回编辑</button></div></div></section>
  </template>
 </main>
</template>
