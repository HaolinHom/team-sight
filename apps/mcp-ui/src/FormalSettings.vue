<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'
import { followHostTheme } from './host-theme'
import { categories, settingsTarget, settingsPatch, type SettingsTarget, type Settings, type Snapshot, type Member } from './settings-model'
import './theme.css'

const app = new App({ name: 'TeamSight settings', version: '0.2.1' }, {}, { autoResize: true })
const settings = reactive<Settings>({ schemaVersion: 5, teamName: '', timeZone: 'Asia/Shanghai', projects: [], members: [], groups: [{ id:'default', name:'默认分组', memberIds:[] }], defaultGroupId:'default', hours:{dailyRequiredHours:8,exemptions:[],completedStates:[]}, chinaCalendar:{enabled:false,years:{}},tapd:{baseUrl:'https://api.tapd.cn',workspaceIds:[],defaultTypes:['task','bug'],writeAccess:{workspaceIds:[],operations:[],fields:[]}},updatedAt:'' })
const formEl=ref<HTMLFormElement>()
const baseline = ref<Settings>(), revision = ref(0), credentialPresent = ref(false), tapdToken = ref(''), legacyJson = ref('')
const target = ref<SettingsTarget | null>(null), fromOverview = ref(false), connected = ref(false), busy = ref(false), failed = ref(false), conflict = ref(false), message = ref('正在连接…')
const editing = ref<number | null>(null), memberQuery = ref(''), candidates = ref<Member[]>([])
const pendingAction = ref<null | (() => Promise<void>)>(null)
const dirty = computed(() => !!baseline.value && (Object.keys(settingsPatch(baseline.value,settings)).length > 0 || !!tapdToken.value))
const title = computed(() => categories.find(item => item.id === target.value)?.title ?? 'TeamSight 设置')
const summary=(id:string)=>id==='connection'?(credentialPresent.value?'已配置':'待配置'):id==='projects'?settings.projects.filter(row=>row.enabled).length+' 个启用项目':id==='members'?settings.members.length+' 位已保存成员':id==='groups'?settings.groups.length+' 个分组':id==='hours'?settings.hours.dailyRequiredHours+'h / 日':id==='calendar'?(settings.chinaCalendar.enabled?'已启用':'未启用'):id==='leave'?settings.hours.exemptions.length+' 条请假':''
const description = computed(() => categories.find(item => item.id === target.value)?.description ?? '选择需要调整的配置')
const split = (value: string) => value.split(',').map(value=>value.trim()).filter(Boolean)
let disposed = false
function snapshot(value: Snapshot) {
  Object.assign(settings,JSON.parse(JSON.stringify(value.settings)))
  settings.tapd.writeAccess ??= {workspaceIds:[],operations:[],fields:[]}
  baseline.value = JSON.parse(JSON.stringify(settings))
  revision.value = value.revision; credentialPresent.value = value.credentialPresent; conflict.value = false
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({name,arguments:JSON.parse(JSON.stringify(args))})
  const data = response.structuredContent as Record<string, unknown> | undefined
  if (!data) throw new Error('未收到有效结果，请重试。')
  if (response.isError) {
    if (data.code === 'REVISION_CONFLICT') { conflict.value = true; throw new Error('配置已在其他卡片或会话中更改。你的编辑已保留，请先重新读取最新配置再编辑。') }
    throw new Error('操作失败：'+String(data.code ?? 'UNKNOWN'))
  }
  return data
}
async function action(fn: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true; failed.value = false
  try { await fn(); return true } catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : '操作失败，请重试。'; return false }
  finally { busy.value = false }
}
function discard() { if (baseline.value) Object.assign(settings,JSON.parse(JSON.stringify(baseline.value))); tapdToken.value=''; editing.value=null }
function guard(fn: () => Promise<void>) { if (dirty.value) pendingAction.value=fn; else void fn() }
const reload = () => guard(async () => { await action(async()=>{snapshot(await call('teamsight_read_settings') as unknown as Snapshot);message.value='已读取最新配置。'}) })
async function save() {
  const form=formEl.value
  if(form&&!form.reportValidity())return false
  const unique=(values:string[])=>new Set(values).size===values.length
  if(settings.projects.some(row=>!row.id.trim()||!row.name.trim())||settings.members.some(row=>!row.staffId.trim()||!row.name.trim())||settings.groups.some(row=>!row.name.trim())||!unique(settings.projects.map(row=>row.id))||!unique(settings.members.map(row=>row.staffId))){failed.value=true;message.value='请填写有效的项目、成员和分组；项目 ID 与成员工号不能重复。';return false}
  if (!baseline.value || !dirty.value) return true
  return action(async()=>{
    const data=await call('teamsight_save_settings',{expectedRevision:revision.value,patch:settingsPatch(baseline.value!,settings),...(tapdToken.value?{tapdToken:tapdToken.value}:{})})
    snapshot(data as unknown as Snapshot);tapdToken.value='';editing.value=null
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
function openCategory(value: SettingsTarget) { guard(async()=>{target.value=value;editing.value=null;message.value='';failed.value=false}) }
function move<T extends {order?:number}>(rows:T[],index:number,delta:number) {if(index+delta<0||index+delta>=rows.length)return;rows.splice(index+delta,0,rows.splice(index,1)[0]);rows.forEach((row,i)=>row.order=i);editing.value=null}
function addProject() {settings.projects.push({id:'',name:'新项目',color:'#eb732d',enabled:true,order:settings.projects.length});editing.value=settings.projects.length-1}
function removeMember(index:number) {const [member]=settings.members.splice(index,1);for(const group of settings.groups)group.memberIds=group.memberIds.filter(id=>id!==member.staffId)}
function addMember() {settings.members.push({staffId:'',name:'新成员',account:'',enabled:true,order:settings.members.length});editing.value=settings.members.length-1}
function removeGroup(index:number) {if(settings.groups.length<2)return;const [group]=settings.groups.splice(index,1);if(settings.defaultGroupId===group.id)settings.defaultGroupId=settings.groups[0].id}
const syncProjects=()=>guard(async()=>{await action(async()=>{const data=await call('teamsight_sync_projects');snapshot(data as unknown as Snapshot);const ready=(data.bootstrap as {currentUser?:string}|undefined)?.currentUser==='complete';failed.value=!ready;message.value=ready?'已同步项目与当前用户，原有项目偏好已保留。':'项目已同步，当前用户身份尚未确认，请在对话中协助解析。';if(ready)await notifyContinue()})})
const discover=(account?:string)=>guard(async()=>{await action(async()=>{const data=await call('teamsight_resolve_members',{query:memberQuery.value,selectedAccount:account});candidates.value=(data.candidates as Member[])??[];if(data.status==='resolved'){snapshot(await call('teamsight_read_settings') as unknown as Snapshot);candidates.value=[];message.value='已保存成员身份，尚未加入任何团队分组。'}else message.value='请选择匹配的成员。'})})
const refreshYear=(year:number)=>guard(async()=>{await action(async()=>{await call('teamsight_refresh_calendar',{year});snapshot(await call('teamsight_read_settings') as unknown as Snapshot);message.value='日历已刷新。'})})
const importSettings=()=>guard(async()=>{await action(async()=>{if(!legacyJson.value.trim())throw new Error('请先粘贴旧配置。');snapshot(await call('teamsight_import_settings',{expectedRevision:revision.value,settingsJson:legacyJson.value,source:'legacy-settings.json'}) as unknown as Snapshot);legacyJson.value='';message.value='旧配置已导入，凭据字段未导入。'})})
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
    <header><div><h1>{{ title }}</h1><p class="muted">{{ description }}</p></div><button v-if="fromOverview && target!=='overview'" type="button" @click="openCategory('overview')" :disabled="busy">返回分类</button></header>
    <p v-if="!connected || target===null" role="status" class="notice">{{ failed ? message : '正在读取配置…' }}</p>
    <template v-if="connected && target!==null">
      <div v-if="target==='overview'" class="categories"><button v-for="item in categories" :key="item.id" @click="openCategory(item.id)"><strong>{{item.title}}</strong><small>{{summary(item.id)||item.description}}</small><span aria-hidden="true">›</span></button></div>
      <form v-else ref="formEl" @submit.prevent="save">
        <fieldset :disabled="busy">
          <section v-if="target==='connection'">
            <div class="notice"><strong>{{credentialPresent?'令牌已配置':'尚未配置令牌'}}</strong><p class="muted">当前用户：{{settings.currentUser?.name ?? '尚未解析'}}</p></div>
            <label>TAPD 个人令牌<input v-model="tapdToken" type="password" autocomplete="off" placeholder="留空保持原令牌" :required="!credentialPresent"></label><small>保存到系统凭据库，已保存的令牌不会回显。</small>
            <details><summary>高级连接设置</summary><label>API 地址<input v-model="settings.tapd.baseUrl" type="url" required></label></details>
            <button v-if="credentialPresent" type="button" @click="syncProjects">重试身份与项目同步</button>
          </section>
          <section v-if="target==='projects'">
            <div class="actions section-actions"><small>同步立即生效，已有启停与别名保持。</small><button type="button" @click="syncProjects">同步项目</button><button type="button" @click="addProject">添加项目</button></div>
            <p v-if="!settings.projects.length" class="empty">尚无项目，请同步当前用户有权限的项目。</p>
            <article v-for="(project,index) in settings.projects" :key="index" class="list-item">
              <div class="item-head"><div class="item-name"><span class="color-dot" :style="{background:project.color}"></span><strong>{{project.name||'新项目'}}</strong></div><label class="inline"><input v-model="project.enabled" type="checkbox" :aria-label="project.name+' 启用'">{{project.enabled?'已启用':'已停用'}}</label></div>
              <div class="item-bottom"><small>别名：{{project.alias||'未设置'}} · {{project.id||'待填写项目 ID'}}</small><div class="actions"><button type="button" @click="editing=editing===index?null:index">{{editing===index?'收起':'编辑'}}</button><button type="button" aria-label="项目上移" :disabled="index===0" @click="move(settings.projects,index,-1)">↑</button><button type="button" aria-label="项目下移" :disabled="index===settings.projects.length-1" @click="move(settings.projects,index,1)">↓</button></div></div>
              <div v-if="editing===index" class="edit-grid"><label>项目名称<input v-model="project.name" required></label><label>别名<input v-model="project.alias"></label><label>项目 ID<input v-model="project.id" required></label><label>颜色<input v-model="project.color" type="color"></label><button class="danger" type="button" @click="settings.projects.splice(index,1);editing=null">删除项目</button></div>
            </article>
          </section>
          <section v-if="target==='members'">
            <div class="search"><input v-model="memberQuery" aria-label="查找成员" placeholder="姓名、工号或完整账号"><button type="button" :disabled="!memberQuery.trim()" @click="discover()">查找成员</button></div><small>查找并选择后立即保存身份，不会自动加入团队。</small>
            <div class="candidates"><button v-for="member in candidates" :key="member.account" type="button" @click="discover(member.account)">{{member.name}} · {{member.account}}</button></div>
            <p v-if="!settings.members.length" class="empty">尚无成员，可先查找成员。</p>
            <article v-for="(member,index) in settings.members" :key="index" class="list-item"><div class="item-head"><strong>{{member.name||'新成员'}}</strong><label class="inline"><input v-model="member.enabled" type="checkbox">启用</label></div><div class="item-bottom"><small>{{member.account||member.staffId||'待填写身份'}}<span class="tags"><span v-for="group in settings.groups.filter(g=>g.memberIds.includes(member.staffId))" :key="group.id">{{group.name}}</span></span></small><div class="actions"><button type="button" @click="editing=editing===index?null:index">编辑</button><button type="button" aria-label="成员上移" :disabled="index===0" @click="move(settings.members,index,-1)">↑</button><button type="button" aria-label="成员下移" :disabled="index===settings.members.length-1" @click="move(settings.members,index,1)">↓</button></div></div><div v-if="editing===index" class="edit-grid"><label>姓名<input v-model="member.name" required></label><label>工号<input v-model="member.staffId" required></label><label>完整账号<input v-model="member.account"></label><button type="button" class="danger" @click="removeMember(index);editing=null">删除本地成员</button></div></article>
            <button type="button" @click="addMember">手动添加成员</button>
          </section>
          <section v-if="target==='groups'">
            <label>默认团队分组<select v-model="settings.defaultGroupId"><option v-for="group in settings.groups" :key="group.id" :value="group.id">{{group.name}}</option></select></label><small>未指定团队范围时使用默认组；一个成员可加入多个组。</small>
            <article v-for="(group,index) in settings.groups" :key="group.id" class="list-item"><label>分组名称<input v-model="group.name" required></label><label class="inline"><input v-model="group.testing" type="checkbox">测试人员组</label><div class="member-options"><label v-for="member in settings.members" :key="member.staffId" class="inline"><input v-model="group.memberIds" type="checkbox" :value="member.staffId">{{member.name}}</label></div><p v-if="!settings.members.length" class="muted">请先在成员配置中添加成员。</p><button type="button" class="danger" :disabled="settings.groups.length<2" @click="removeGroup(index)">删除分组</button></article><button type="button" @click="settings.groups.push({id:'group-'+Date.now(),name:'新分组',memberIds:[]})">添加分组</button>
          </section>
          <section v-if="target==='hours'"><label>每日规定工时<input v-model.number="settings.hours.dailyRequiredHours" type="number" min="0" max="24" step="0.5" required></label><small>作为工时目标和每日排期容量的依据。</small><label>业务时区<select v-model="settings.timeZone"><option value="Asia/Shanghai">Asia/Shanghai</option><option value="UTC">UTC</option></select></label></section>
          <section v-if="target==='calendar'"><label class="inline"><input v-model="settings.chinaCalendar.enabled" type="checkbox">启用中国节假日与调休</label><p class="muted">已有年份缓存持续复用，缺失年份由分析服务自动获取。</p><div class="actions"><button v-for="year in Object.keys(settings.chinaCalendar.years)" :key="year" type="button" @click="refreshYear(Number(year))">刷新 {{year}}</button></div><small>刷新缓存立即生效。</small></section>
          <section v-if="target==='leave'"><p v-if="!settings.hours.exemptions.length" class="empty">暂无请假记录。</p><article v-for="(leave,index) in settings.hours.exemptions" :key="index" class="list-item edit-grid"><label>成员<select v-model="leave.staffId" required><option v-for="member in settings.members" :key="member.staffId" :value="member.staffId">{{member.name}}</option></select></label><label>日期<input v-model="leave.date" type="date" required></label><label>请假小时<input v-model.number="leave.hours" type="number" min="0.1" max="24" step="0.5" required></label><label>备注<input v-model="leave.note"></label><button type="button" class="danger" @click="settings.hours.exemptions.splice(index,1)">删除请假</button></article><button type="button" :disabled="!settings.members.length" @click="settings.hours.exemptions.push({staffId:settings.members[0]?.staffId??'',date:'',hours:8,note:''})">添加请假</button><p class="muted">有效目标为规定工时减去请假小时，最低为 0。</p></section>
          <section v-if="target==='completed'"><article v-for="(rule,index) in settings.hours.completedStates" :key="index" class="list-item"><label>项目<select v-model="rule.projectId" required><option v-for="project in settings.projects" :key="project.id" :value="project.id">{{project.alias||project.name}}</option></select></label><label>类型<select v-model="rule.type"><option value="task">任务</option><option value="bug">缺陷</option></select></label><label>结束状态（逗号分隔）<input :value="rule.values.join(', ')" @input="rule.values=split(($event.target as HTMLInputElement).value)"></label><button type="button" class="danger" @click="settings.hours.completedStates.splice(index,1)">移除规则</button></article><button type="button" :disabled="!settings.projects.length" @click="settings.hours.completedStates.push({projectId:settings.projects[0]?.id??'',type:'task',values:[]})">添加状态规则</button></section>
          <section v-if="target==='write' && settings.tapd.writeAccess"><p class="notice">项目启用不代表允许写入。下面的范围只对已勾选项目、操作和字段生效。</p><h2>允许写入的项目</h2><div class="member-options"><label v-for="project in settings.projects" :key="project.id" class="inline"><input v-model="settings.tapd.writeAccess.workspaceIds" type="checkbox" :value="project.id">{{project.alias||project.name}}</label></div><label>其他项目 ID（逗号分隔）<input :value="settings.tapd.writeAccess.workspaceIds.join(', ')" @input="settings.tapd.writeAccess.workspaceIds=split(($event.target as HTMLInputElement).value)"></label><div class="actions"><label class="inline"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="create">创建</label><label class="inline"><input v-model="settings.tapd.writeAccess.operations" type="checkbox" value="update">修改</label></div><label>允许写入字段（逗号分隔）<input :value="settings.tapd.writeAccess.fields.join(', ')" placeholder="name, description, owner, begin, due, effort, status" @input="settings.tapd.writeAccess.fields=split(($event.target as HTMLInputElement).value)"></label></section>
          <section v-if="target==='general'"><label>团队名称<input v-model="settings.teamName" required maxlength="80"></label><label>默认查询项目 ID（逗号分隔）<input :value="settings.tapd.workspaceIds.join(', ')" @input="settings.tapd.workspaceIds=split(($event.target as HTMLInputElement).value)"></label><div class="actions"><label class="inline"><input v-model="settings.tapd.defaultTypes" type="checkbox" value="task">任务</label><label class="inline"><input v-model="settings.tapd.defaultTypes" type="checkbox" value="bug">缺陷</label></div></section>
          <section v-if="target==='import'"><label>旧版 settings.json<textarea v-model="legacyJson" rows="6" placeholder="粘贴旧配置；凭据字段不会导入"></textarea></label><button type="button" :disabled="!legacyJson.trim()" @click="importSettings">导入配置</button><p class="muted">导入立即生效，并替换本地业务配置。令牌需在连接配置中单独填写。</p></section>
          <footer v-if="target!=='import'" class="save-bar"><small>{{dirty?'有未保存的更改':'所有更改已保存'}}</small><div class="actions"><button type="button" :disabled="!dirty" @click="discard">取消</button><button class="primary" type="button" :disabled="!dirty||conflict" @click="save">{{busy?'保存中…':'保存更改'}}</button></div></footer>
        </fieldset>
      </form>
      <section v-if="pendingAction" class="notice" aria-label="未保存更改"><p>你有未保存的更改，处理后再继续。</p><div class="actions"><button class="primary" :disabled="busy||conflict" @click="resumePending(true)">保存后继续</button><button :disabled="busy" @click="resumePending(false)">放弃后继续</button><button :disabled="busy" @click="pendingAction=null">返回编辑</button></div></section>
      <p v-if="message" :class="failed?'error':'notice'" :role="failed?'alert':'status'">{{message}}<button v-if="conflict" type="button" @click="reload">重新读取</button></p>
    </template>
  </main>
</template>

<style scoped>
.settings-card{max-width:760px;margin:0 auto;padding:16px}header{display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:20px}header p{margin:5px 0 0}fieldset{border:0;margin:0;padding:0;min-width:0}label:not(.inline){display:flex;flex-direction:column;gap:6px;margin:14px 0}input:not([type=checkbox]):not([type=radio]),select,textarea{width:100%}input[type=color]{height:40px;padding:4px!important}textarea{resize:vertical}.categories{display:grid;grid-template-columns:1fr 1fr;gap:8px}.categories button{text-align:left;padding:14px 32px 14px 14px;position:relative;border-color:var(--ts-line)}.categories small{display:block;margin-top:3px}.categories span{position:absolute;right:14px;top:23px;color:var(--ts-accent);font-size:20px}.section-actions{justify-content:flex-end;margin-bottom:8px}.section-actions small{flex:1;min-width:180px}.list-item{padding:16px 0;border-bottom:1px solid var(--ts-line)}.list-item:first-of-type{border-top:1px solid var(--ts-line)}.item-head,.item-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px}.item-bottom{margin-top:8px}.item-name{display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}.color-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;border:1px solid var(--ts-border)}.edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;padding:12px;margin-top:12px;background:var(--ts-soft);border-radius:8px}.search{display:flex;gap:8px}.search input{flex:1}.search button{white-space:nowrap}.candidates{display:grid;gap:8px;margin:12px 0}.member-options{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.tags span{background:var(--ts-soft);border-radius:4px;padding:1px 6px}.save-bar{border-top:1px solid var(--ts-line);margin-top:20px;padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}details{margin:16px 0}summary{color:var(--ts-accent);cursor:pointer}@media(max-width:480px){.settings-card{padding:12px}.categories,.edit-grid{grid-template-columns:1fr}.item-head,.item-bottom{align-items:start;flex-wrap:wrap}.item-bottom .actions{margin-left:auto}.save-bar{flex-wrap:wrap}}
</style>
