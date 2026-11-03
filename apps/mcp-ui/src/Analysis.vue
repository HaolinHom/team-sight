<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { App } from '@modelcontextprotocol/ext-apps'
import { computeLayout, type TeamAnalysis, type ScheduleTask, type HoursIssue } from '@teamsight/core'

type View = Pick<TeamAnalysis, 'analysisId' | 'snapshotId' | 'status' | 'fetchedAt' | 'context' | 'unit' | 'risks' | 'limitations'> & {
  members: (TeamAnalysis['members'][number] & { pendingCount: number; pendingTruncated: boolean })[]
  tasks: ScheduleTask[]; issues: HoursIssue[]; nextTaskOffset: number | null; nextMemberOffset: number | null
  risksTruncated: boolean; counts: { risks: number; issues: number }
}
type Artifact = { id: string; filename: string; mimeType: string; size: number }
const app = new App({ name: 'TeamSight analysis', version: '0.1.0-p1b' }, {}, { autoResize: true })
const start = ref(''), end = ref(''), analysisDate = ref('')
const selectedMember = ref(''), tab = ref<'gantt' | 'hours' | 'risks'>('gantt')
const view = ref<View | null>(null), busy = ref(false), connected = ref(false), error = ref(''), message = ref('正在连接宿主…')
const artifacts = ref<Artifact[]>([]), previewText = ref(''), previewImage = ref(''), jobId = ref('')
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
const members = computed(() => view.value?.members.filter(member => !selectedMember.value || member.member.staffId === selectedMember.value) ?? [])
const tasks = computed(() => view.value?.tasks.filter(task => !selectedMember.value || task.assigneeIds.includes(selectedMember.value)) ?? [])
const risks = computed(() => view.value?.risks.filter(risk => !selectedMember.value || !risk.staffId || risk.staffId === selectedMember.value) ?? [])
const layout = computed(() => view.value ? computeLayout({ tasks: tasks.value.filter(task => !task.startDate || !task.dueDate || task.startDate > task.dueDate || task.startDate <= view.value!.context.range.end && task.dueDate >= view.value!.context.range.start), range: view.value.context.range,
  today: view.value.context.analysisDate, memberOrder: view.value.context.memberIds.map(id => `staff:${id}`), memberNames: new Map(view.value.members.map(member => [`staff:${member.member.staffId}`, member.member.name])),
  memberKeysOf: task => task.assigneeIds.filter(id => view.value!.members.some(member => member.member.staffId === id) && (!selectedMember.value || id === selectedMember.value)).map(id => `staff:${id}`) }) : null)
const number = (value: number) => String(Math.floor((value + 1e-9) * 100) / 100)
const color = (value: string) => /^#[\da-f]{6}$/i.test(value) ? value : '#167d7f'
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await app.callServerTool({ name, arguments: JSON.parse(JSON.stringify(args)) })
  const data = response.structuredContent as Record<string, unknown> | undefined
  if (response.isError || !data) throw new Error(data?.code === 'CONFIG_REQUIRED' ? '请先打开设置，配置 TAPD、项目和成员。' : `操作失败：${data?.code ?? 'UNKNOWN'}`)
  return { data, response }
}
async function load(id: string) {
  const { data } = await call('teamsight_read_analysis', { analysisId: id })
  view.value = data as unknown as View
  start.value = view.value.context.range.start; end.value = view.value.context.range.end; analysisDate.value = view.value.context.analysisDate
  artifacts.value = []; previewText.value = ''; previewImage.value = ''
  message.value = `已读取分析 · ${view.value.status === 'complete' ? '数据完整' : view.value.status === 'partial' ? '部分数据' : '取数失败'}`
}
async function poll(id: string, token: number) {
  try {
    const { data } = await call('teamsight_get_job', { jobId: id })
    if (disposed || token !== generation) return
    if (data.status === 'completed' && data.analysisId) { await load(String(data.analysisId)); busy.value = false; jobId.value = ''; return }
    if (data.status !== 'running') throw new Error(`分析${data.status === 'cancelled' ? '已取消' : '未完成'}：${data.code ?? data.status}`)
    message.value = '正在读取项目与累计工时…'
    timer = setTimeout(() => { void poll(id, token) }, 1500)
  } catch (cause) { if (token === generation) { error.value = cause instanceof Error ? cause.message : '分析失败'; busy.value = false; jobId.value = '' } }
}
async function analyze(refresh = false) {
  const token = ++generation
  clearTimeout(timer); busy.value = true; error.value = ''
  try {
    const { data } = await call('teamsight_analyze_hours', { start: start.value, end: end.value, analysisDate: analysisDate.value || undefined, refresh })
    if (disposed || token !== generation) return
    if (data.analysisId) { await load(String(data.analysisId)); busy.value = false }
    else if (data.status === 'running' && data.jobId) { jobId.value = String(data.jobId); await poll(jobId.value, token) }
    else throw new Error(`分析未完成：${data.code ?? data.status}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '分析失败'; busy.value = false }
}
async function cancel() {
  ++generation; clearTimeout(timer)
  try { if (jobId.value) await call('teamsight_cancel_job', { jobId: jobId.value }) } catch (cause) { error.value = String(cause) }
  jobId.value = ''; busy.value = false; message.value = '已请求取消分析'
}
async function more(kind: 'members' | 'tasks') {
  if (!view.value) return
  busy.value = true; error.value = ''
  try {
    const offset = kind === 'members' ? view.value.nextMemberOffset : view.value.nextTaskOffset
    const { data } = await call('teamsight_read_analysis', { analysisId: view.value.analysisId, [kind === 'members' ? 'memberOffset' : 'taskOffset']: offset })
    const next = data as unknown as View
    if (kind === 'members') { view.value.members.push(...next.members); view.value.nextMemberOffset = next.nextMemberOffset }
    else { view.value.tasks.push(...next.tasks); view.value.nextTaskOffset = next.nextTaskOffset }
  } catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
async function moreRisks() {
  if (!view.value) return
  busy.value = true; error.value = ''
  try {
    const { data } = await call('teamsight_check_risks', { analysisId: view.value.analysisId, offset: view.value.risks.length })
    view.value.risks.push(...data.risks as View['risks']); view.value.risksTruncated = data.nextOffset !== null
  } catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
async function exportFile(format: string) {
  if (!view.value) return
  busy.value = true; error.value = ''
  try {
    const gantt = ['png', 'svg'].includes(format)
    const { data } = await call(gantt ? 'teamsight_render_gantt' : 'teamsight_generate_report', { analysisId: view.value.analysisId, format })
    artifacts.value = data.artifacts as Artifact[]
    message.value = `已生成 ${artifacts.value.length} 个文件，使用当前完整分析范围`
  } catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
async function preview(artifact: Artifact) {
  try {
    const { data, response } = await call('teamsight_read_artifact', { artifactId: artifact.id, maxChars: 48000 })
    const image = response.content.find(content => content.type === 'image')
    previewImage.value = image?.type === 'image' ? `data:${image.mimeType};base64,${image.data}` : ''
    previewText.value = image ? '' : String(data.text ?? '') + (data.nextOffset ? '\n…预览已截断，完整文件可通过产物资源读取。' : '')
  } catch (cause) { error.value = String(cause) }
}
async function openSettings() { try { await call('teamsight_open_settings') } catch (cause) { error.value = String(cause) } }
async function openItem(task: ScheduleTask) { try { await app.openLink({ url: task.tapdUrl }) } catch (cause) { error.value = `打开 TAPD 失败：${String(cause)}` } }
onMounted(async () => {
  app.ontoolresult = async result => {
    const data = result.structuredContent as Record<string, unknown> | undefined
    if (data?.analysisId) await load(String(data.analysisId)).catch(cause => { error.value = String(cause) })
    else if (data?.defaults) Object.assign({ set start(value: string) { start.value = value }, set end(value: string) { end.value = value }, set analysisDate(value: string) { analysisDate.value = value } }, data.defaults)
  }
  try {
    await app.connect(); connected.value = true; message.value = '已连接 · 选择日期后开始分析'
    if (!start.value) {
      const { data } = await call('teamsight_open_analysis')
      const defaults = data.defaults as { start: string; end: string; analysisDate: string } | undefined
      if (defaults) { start.value = defaults.start; end.value = defaults.end; analysisDate.value = defaults.analysisDate }
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '宿主连接失败' }
})
onUnmounted(() => { disposed = true; ++generation; clearTimeout(timer) })
</script>

<template>
  <main>
    <header><div><small>TEAMSIGHT · P1b</small><h1>排期与工时</h1></div><button :disabled="!connected" @click="openSettings">设置</button></header>
    <form class="toolbar" @submit.prevent="analyze()">
      <label>开始日期<input v-model="start" type="date" required :disabled="busy"></label>
      <label>结束日期<input v-model="end" type="date" required :disabled="busy"></label>
      <label>分析日<input v-model="analysisDate" type="date" required :disabled="busy"></label>
      <button class="primary" :disabled="busy || !connected">开始分析</button><button type="button" :disabled="busy || !connected" @click="analyze(true)">刷新数据</button><button v-if="jobId" type="button" @click="cancel">取消</button>
    </form>
    <p role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="view">
      <aside :class="{ warning: view.status !== 'complete' }"><strong>{{ view.status === 'complete' ? '数据完整' : view.status === 'partial' ? '部分数据，缺口待确认' : '取数失败' }}</strong> · 来源 {{ view.fetchedAt }} · {{ view.context.timeZone }} · 小时
        <details><summary>范围与数据限制</summary><p>{{ view.context.range.start }} — {{ view.context.range.end }} · 配置修订 {{ view.context.configRevision }}</p><ul><li v-for="item in view.limitations" :key="item">{{ item }}</li><li v-for="(issue, index) in view.issues" :key="index">{{ issue.projectId }}：{{ issue.message }}</li></ul><p v-if="view.counts.issues > view.issues.length">问题共 {{ view.counts.issues }} 条，此处展示前 {{ view.issues.length }} 条；完整记录可在 JSON 导出中查看。</p></details>
      </aside>
      <nav aria-label="分析视图"><button v-for="item in ([['gantt','甘特图'],['hours','每日工时'],['risks','风险与依据']] as const)" :key="item[0]" :aria-pressed="tab === item[0]" @click="tab = item[0]">{{ item[1] }}</button><label>成员<select v-model="selectedMember"><option value="">所有已加载成员</option><option v-for="member in view.members" :key="member.member.staffId" :value="member.member.staffId">{{ member.member.name }}</option></select></label></nav>
      <div v-if="tab === 'gantt' && layout" class="scroll" aria-label="成员分组甘特图">
        <svg :width="layout.totalWidth + 280" :height="Math.max(layout.totalHeight, 48) + 44" role="img" aria-label="当前排期">
          <rect width="100%" height="100%" fill="white"/>
          <g v-for="(date,index) in layout.days" :key="date"><text :x="284 + index * 40" y="23" font-size="10">{{ date.slice(5) }}</text><path :d="`M${280 + index * 40} 35v${layout.totalHeight}`" stroke="#e4ebef"/></g>
          <g v-for="row in layout.rows" :key="row.key"><rect x="0" :y="row.y + 36" :width="layout.totalWidth + 280" :height="row.height" :fill="row.type === 'member' ? '#edf5f6' : 'transparent'"/><text x="12" :y="row.y + 57"><title>{{ row.type === 'member' ? row.memberName : row.title }}</title>{{ row.type === 'member' ? row.memberName : Array.from(row.title).slice(0,17).join('') + (row.title.length > 17 ? '…' : '') }}</text></g>
          <g v-for="bar in layout.bars.filter(bar => bar.width > 0)" :key="bar.key"><title>{{ bar.title }} · {{ bar.startDate }} — {{ bar.dueDate }}</title><rect :x="bar.x + 280" :y="bar.y + 36" :width="bar.width" :height="bar.height" rx="4" :fill="color(bar.color)" :opacity="bar.completed ? .4 : .9"/></g>
          <text v-if="!tasks.length" x="12" y="65">当前覆盖内无工作项；完整性以分析状态为准。</text>
        </svg>
      </div>
      <section v-if="tab === 'hours'">
        <div v-for="member in members" :key="member.member.staffId"><h2>{{ member.member.name }}</h2><div class="scroll"><table><thead><tr><th>日期</th><th>目标</th><th>实际</th><th>未来预计</th><th>差额</th><th>明细</th></tr></thead><tbody><tr v-for="day in member.days" :key="day.date"><th>{{ day.date }}<small v-if="day.date === view.context.analysisDate">当天进度</small></th><td>{{ number(day.target) }}<small v-if="day.leaveHours">请假 {{ number(day.leaveHours) }}h</small></td><td>{{ day.reasons.length ? '已知 ' : '' }}{{ number(day.actual) }}</td><td>{{ number(day.allocated) }}</td><td>{{ day.reasons.length ? '未知' : number(day.deficit) }}</td><td><details><summary>{{ day.reasons.length ? '含待确认项' : '查看' }}</summary><ul><li v-for="c in day.contributions" :key="c.taskKey">{{ c.taskKey }} · 实际 {{ number(c.actual) }} / 预计 {{ number(c.allocated) }} · {{ c.explanation }}</li><li v-for="(reason,index) in day.reasons" :key="index">{{ reason.message }}</li></ul></details></td></tr></tbody></table></div><details v-if="member.pending.length"><summary>待安排 / 未知剩余量（{{ member.pendingCount }}）</summary><ul><li v-for="item in member.pending" :key="item.task.id">{{ item.task.title }} · {{ item.hours === null ? '未知工时' : `${number(item.hours)}h` }} · {{ item.reason }}</li></ul><p v-if="member.pendingTruncated">此处展示前 50 项；完整明细可在 JSON 导出中查看。</p></details></div>
      </section>
      <section v-if="tab === 'risks'"><p v-if="!risks.length">当前覆盖内未发现风险条目，请同时查看数据限制。</p><article v-for="(risk,index) in risks" :key="index"><strong>{{ risk.message }}</strong><details><summary>查看依据</summary>{{ risk.evidence.join('、') }}</details></article><p v-if="view.risksTruncated" class="warning">风险共 {{ view.counts.risks }} 条，已加载 {{ view.risks.length }} 条。<button :disabled="busy" @click="moreRisks">加载更多风险</button></p></section>
      <p v-if="view.nextTaskOffset !== null || view.nextMemberOffset !== null" class="warning">当前视图分批加载。<button v-if="view.nextTaskOffset !== null" :disabled="busy" @click="more('tasks')">加载更多工作项</button><button v-if="view.nextMemberOffset !== null" :disabled="busy" @click="more('members')">加载更多成员</button>文件导出使用完整分析。</p>
      <details><summary>工作项明细（已加载 {{ tasks.length }} 项）</summary><article v-for="task in tasks" :key="`${task.projectId}:${task.sourceType}:${task.id}`"><strong>{{ task.title }}</strong><p>{{ task.projectName }} · {{ task.status }} · {{ task.startDate ?? '缺开始日' }} — {{ task.dueDate ?? '缺截止日' }} · 预估 {{ task.effort ?? '未知' }}h</p><small>{{ task.projectId }}:{{ task.sourceType }}:{{ task.id }}</small><button @click="openItem(task)">在 TAPD 中查看</button></article></details>
      <footer><strong>导出完整分析</strong><button v-for="format in ['png','svg','csv','markdown','html','json']" :key="format" :disabled="busy" @click="exportFile(format)">{{ format === 'markdown' ? 'Markdown' : format.toUpperCase() }}</button><ul><li v-for="artifact in artifacts" :key="artifact.id">{{ artifact.mimeType }} · {{ Math.ceil(artifact.size / 1024) }} KB <button @click="preview(artifact)">预览</button></li></ul><img v-if="previewImage" :src="previewImage" alt="导出的甘特图"><pre v-if="previewText">{{ previewText }}</pre></footer>
    </template>
  </main>
</template>

<style>
:root{font-family:system-ui,-apple-system,'PingFang SC',sans-serif;color:#203846;background:#f7fafb;font-size:14px}*{box-sizing:border-box}body{margin:0}main{padding:20px;max-width:1400px;margin:auto}header,nav,.toolbar{display:flex;align-items:end;gap:10px;flex-wrap:wrap}header{align-items:center;justify-content:space-between}h1{margin:4px 0 18px;font-size:26px}h2{font-size:18px}small{display:block;color:#637c8a;font-size:11px}label{display:flex;gap:5px;flex-direction:column}button,input,select{font:inherit;padding:8px 11px;border:1px solid #c7d5dd;border-radius:7px;background:white;color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary,button[aria-pressed=true]{background:#167d7f;color:white;border-color:#167d7f}aside,footer,article{background:white;padding:14px;border:1px solid #dce6eb;border-radius:10px;margin:14px 0}.warning{background:#fff6df;padding:12px}.error{color:#a62424;background:#fff0f0;padding:12px}nav{margin:16px 0;align-items:center}.scroll{overflow:auto;border:1px solid #dce6eb;background:white;border-radius:8px}svg{display:block;font:13px system-ui,'PingFang SC',sans-serif}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:9px;border-bottom:1px solid #e4ebef}thead{background:#edf5f6}td details{white-space:normal;min-width:200px}summary{cursor:pointer}li{margin:6px 0}footer button{margin:4px}pre{overflow:auto;max-height:360px;white-space:pre-wrap;font-size:12px}img{max-width:100%;height:auto}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #97d5d5;outline-offset:2px}@media(max-width:600px){main{padding:12px}h1{font-size:22px}.toolbar label{width:46%}}
</style>
