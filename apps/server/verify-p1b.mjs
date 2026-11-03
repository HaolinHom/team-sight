/** Explicit live acceptance. Never logs credentials; writes only to the named workspace. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { openStore } from './dist/storage.js'
import { startServer } from './dist/server.js'
import { businessDate, addDays } from '@teamsight/core'

const args = process.argv.slice(2)
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const workspaceId = option('--workspace', '')
if (workspaceId !== '62119705' || !args.includes('--execute-writes')) throw new Error('Requires --workspace 62119705 --execute-writes; this acceptance creates and updates a marked story and task.')
const root = resolve(new URL('../..', import.meta.url).pathname)
const dataDir = resolve(root, '.local/teamsight-p1b-live')
const evidenceDir = resolve(option('--evidence-dir', join(root, 'artifacts/report/20261028_teamsight-p1b_evidence')))
mkdirSync(evidenceDir, { recursive: true })
const credentialPath = join(homedir(), 'Library/Application Support/com.haolinhom.team-sight/credentials.json')
const env = existsSync(join(root, '.env.local')) ? Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').split('\n').flatMap(line => {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim()); return match ? [[match[1], match[2].replace(/^"|"$/g, '')]] : []
})) : {}
const credential = existsSync(credentialPath) ? JSON.parse(readFileSync(credentialPath, 'utf8')).token : env.PERSONAL_TOKEN
if (!credential) throw new Error('CONFIG_REQUIRED: no existing local TAPD credential')
const store = openStore(dataDir)
const previous = store.readSettings()
const previousReceipts = new Map(store.db.prepare('SELECT idempotency_key, value FROM operations').all().map(row => [row.idempotency_key, JSON.parse(row.value)]))
const date = businessDate('Asia/Shanghai')
if (!previous.credentialPresent || previous.settings.tapd.workspaceIds.join(',') !== workspaceId) store.saveSettings({ expectedRevision: previous.revision, credential, patch: {
  teamName: 'TeamSight P1b 验收', projects: [{ id: workspaceId, name: 'P1b 指定验收项目', enabled: true, color: '#167d7f' }], members: [],
  tapd: { baseUrl: 'https://api.tapd.cn', workspaceIds: [workspaceId], defaultTypes: ['task', 'bug'], writeAccess: { workspaceIds: [workspaceId], operations: ['create', 'update'], fields: ['name', 'description', 'owner', 'begin', 'due', 'effort', 'story_id', 'status'] } },
} })
store.close()
let service, client, transport
const result = { workspaceId, platform: process.platform, arch: process.arch, node: process.version, date, writes: [], checks: [] }
function record(check, detail) { result.checks.push({ check, ...detail }); console.log(JSON.stringify({ check, ...detail })) }
try {
  service = await startServer({ dataDir, port: Number(option('--port', '43129')) })
  const token = readFileSync(join(dataDir, 'access-token'), 'utf8').trim()
  client = new Client({ name: 'teamsight-p1b-live-acceptance', version: '1' })
  transport = new StreamableHTTPClientTransport(new URL(service.info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(`${name}: ${response.structuredContent?.code ?? 'FAILED'}`)
    return response.structuredContent
  }
  const projects = await call('tapd_list_workspaces')
  if (!projects.projects.some(project => project.id === workspaceId)) throw new Error('DESIGNATED_PROJECT_NOT_VISIBLE')
  const schema = await call('tapd_get_workspace_schema', { workspaceId, entityType: 'task' })
  const legacyPath = join(homedir(), 'Library/Application Support/com.haolinhom.team-sight/settings.json')
  const legacyMembers = existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, 'utf8')).members ?? [] : []
  const owner = schema.members.find(member => legacyMembers.some(configured => member.user.endsWith('_' + configured.staffId)))?.user ?? schema.members.find(member => /_\d+$/.test(member.user))?.user
  const staffId = /_(\d+)$/.exec(owner ?? '')?.[1]
  if (!staffId) throw new Error('NO_UNAMBIGUOUS_TEST_MEMBER')
  const snapshot = await call('teamsight_read_settings')
  await call('teamsight_save_settings', { expectedRevision: snapshot.revision, patch: { members: [{ staffId, name: 'P1b 验收成员' }] } })
  record('metadata', { visibleProject: true, memberDirectoryLoaded: true, taskStatusSource: schema.statusSource })
  for (const entityType of ['story', 'task']) {
    const createKey = `p1b-live-${workspaceId}-${entityType}-create-v1`
    const title = `TeamSight P1b 验收 ${date} ${entityType === 'story' ? '需求' : '任务'}`
    const fields = { name: title, owner, begin: date, due: addDays(date, 2), effort: '2', description: 'TeamSight P1b 指定项目的 API 创建与修改验收对象。' }
    if (entityType === 'task') fields.story_id = result.writes.find(item => item.entityType === 'story').remoteId
    const previousReceipt = previousReceipts.get(createKey)
    let created = previousReceipt ? await call('tapd_get_operation', { operationId: previousReceipt.operationId }) : await call('tapd_create_item', { workspaceId, entityType, fields, idempotencyKey: createKey, actor: 'P1b-live-acceptance' })
    if (created.status === 'unknown') created = await call('tapd_verify_operation', { operationId: created.operationId })
    if (created.status !== 'succeeded' || !created.remoteId) throw new Error(`LIVE_CREATE_${created.status}: ${created.code}; receipt ${created.operationId}`)
    const remoteId = created.remoteId
    const updateKey = `p1b-live-${workspaceId}-${entityType}-update-v1`
    const oldUpdate = previousReceipts.get(updateKey)
    let updated
    if (oldUpdate) updated = await call('tapd_get_operation', { operationId: oldUpdate.operationId })
    else {
      const before = await call('tapd_get_item', { workspaceId, entityType, id: remoteId })
      updated = await call('tapd_update_item', { workspaceId, entityType, id: remoteId, expectedDigest: before.digest, fields: { name: title + '（更新已验证）' }, idempotencyKey: updateKey, actor: 'P1b-live-acceptance' })
    }
    if (updated.status === 'unknown') updated = await call('tapd_verify_operation', { operationId: updated.operationId })
    if (updated.status !== 'succeeded') throw new Error(`LIVE_UPDATE_${updated.status}: ${updated.code}; receipt ${updated.operationId}`)
    const after = await call('tapd_get_item', { workspaceId, entityType, id: remoteId })
    if (!String(after.item.name).endsWith('（更新已验证）')) throw new Error('READ_BACK_NAME_MISMATCH')
    result.writes.push({ entityType, remoteId, createOperationId: created.operationId, updateOperationId: updated.operationId, verified: true, url: `https://www.tapd.cn/tapd_fe/${workspaceId}/${entityType}/detail/${remoteId}` })
    record(`${entityType}-create-update-readback`, { remoteId, verified: true })
  }
  let analysis = await call('teamsight_analyze_hours', { start: date, end: addDays(date, 7), analysisDate: date, refresh: true })
  if (!analysis.analysisId) {
    for (let count = 0; count < 300; count++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const job = await call('teamsight_get_job', { jobId: analysis.jobId })
      if (job.status === 'completed') { analysis = job.analysis; break }
      if (job.status !== 'running') throw new Error('LIVE_ANALYSIS_' + job.status)
    }
  }
  if (!analysis.analysisId) throw new Error('ANALYSIS_TIMEOUT')
  result.analysis = analysis
  record('analysis', { analysisId: analysis.analysisId, status: analysis.status, counts: analysis.counts })
  const outputs = []
  for (const format of ['png', 'svg', 'markdown', 'html', 'csv', 'json']) {
    const output = await call(['png', 'svg'].includes(format) ? 'teamsight_render_gantt' : 'teamsight_generate_report', { analysisId: analysis.analysisId, format })
    for (const artifact of output.artifacts) {
      const response = await client.readResource({ uri: artifact.resourceUri })
      if (response.contents[0].mimeType !== artifact.mimeType) throw new Error('ARTIFACT_MIME_MISMATCH')
      copyFileSync(join(dataDir, 'files', artifact.filename), join(evidenceDir, artifact.filename))
      outputs.push(artifact)
    }
  }
  result.artifacts = outputs
  record('outputs', { formats: [...new Set(outputs.map(output => output.mimeType))], files: outputs.length, sameAnalysis: outputs.every(output => output.analysisId === analysis.analysisId) })
  result.ok = true
  writeFileSync(join(evidenceDir, 'live-acceptance.json'), JSON.stringify(result, null, 2))
  if (args.includes('--keep-serving')) console.log(JSON.stringify({ event: 'HOST_SERVICE_READY', phase: service.info.phase, url: service.info.url, dataDir, analysisId: analysis.analysisId }))
} catch (error) {
  result.ok = false; result.error = error.message
  writeFileSync(join(evidenceDir, 'live-acceptance.json'), JSON.stringify(result, null, 2))
  console.error(error.message); process.exitCode = 1
} finally {
  await transport?.terminateSession().catch(() => {})
  await client?.close().catch(() => {})
  if (!args.includes('--keep-serving') || !result.ok) await service?.close()
}
