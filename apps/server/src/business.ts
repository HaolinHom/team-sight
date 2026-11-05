import { randomUUID } from 'node:crypto'
import { calculateHours, checkRisks, validateAnalysisInput, businessDate, mergeCalendar, parseHolidayYear, calendarYearsForRanges, calendarTaskRanges, RULES_VERSION, MCP_RULES_VERSION, resolveMemberScope, parseHours, isHoursCompleted,
  mapScheduleRow, dedupeScheduleTasks, hoursTaskKey, isValidDateKey, type AnalysisContext, type TeamAnalysis, type TeamSightSettings, type WorkItemType, type RawRow } from '@teamsight/core'
import { TapdClient, TapdError, RequestQueue, fetchHoursSnapshot, entityPath, entityKey, fieldsFor, writableFields, type EntityType, type TapdTransport } from '@teamsight/tapd'
import type { TeamSightStore, SettingsSnapshot } from './storage.js'
import { businessStorage, digest, fieldHashes, type OperationReceipt, type JobRecord } from './business-storage.js'

export class BusinessError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) { super(code) }
}
export interface WriteInput {
  workspaceId: string
  entityType: 'story' | 'task'
  fields: Record<string, string>
  idempotencyKey: string
  actor: string
  id?: string
  expectedDigest?: string
  batch?: Pick<OperationReceipt, 'batchId' | 'itemKey' | 'attempt' | 'intentHash'>
}
export interface AnalysisInput { start: string; end: string; analysisDate?: string; projectIds?: string[]; memberIds?: string[]; groupIds?: string[]; scope?: 'self' | 'team'; refresh?: boolean }
const rowDigest = (row: RawRow) => digest(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))
const knownCode = (error: unknown) => error instanceof BusinessError ? error.code : 'TAPD_REQUEST_FAILED'

export function createBusiness(store: TeamSightStore, dataDir: string, transport?: TapdTransport) {
  const files = businessStorage(store.db, dataDir)
  const queue = new RequestQueue(3)
  const running = new Map<string, { controller: AbortController; promise: Promise<unknown> }>()
  const activeWrites = new Set<Promise<unknown>>()
  const calendarAttempts = new Set<number>()
  let cacheGeneration = 0
  function invalidateCache() { cacheGeneration++; files.invalidateCache() }
  async function refreshCalendar(year: number, force = true) {
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new BusinessError('INVALID_YEAR')
    if (!force && (store.readSettings().settings.chinaCalendar.years[String(year)] || calendarAttempts.has(year))) return
    calendarAttempts.add(year)
    for (const url of [`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`]) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
        if (!response.ok) continue
        const parsed = parseHolidayYear(await response.json(), year)
        const current = store.readSettings()
        return store.saveSettings({ expectedRevision: current.revision, patch: { chinaCalendar: { ...current.settings.chinaCalendar, years: { ...current.settings.chinaCalendar.years, [String(year)]: { ...parsed, fetchedAt: new Date().toISOString() } } } } })
      } catch { /* Fixed-source fallback; retain any previous persistent year cache. */ }
    }
    if (force) throw new BusinessError('CALENDAR_REFRESH_FAILED')
  }
  function client(snapshot: SettingsSnapshot) {
    const token = store.getCredential()
    if (!token) throw new BusinessError('CONFIG_REQUIRED', { next: 'teamsight_open_settings' })
    return new TapdClient({ baseUrl: snapshot.settings.tapd.baseUrl, getToken: () => token, transport, queue })
  }
  function assertProject(settings: TeamSightSettings, workspaceId: string) {
    const allowed = settings.projects.filter(project => project.available !== false).map(project => project.id)
    if (!allowed.includes(workspaceId)) throw new BusinessError('PROJECT_NOT_ALLOWED')
  }
  function access(input: WriteInput, action: 'create' | 'update', snapshot: SettingsSnapshot) {
    assertProject(snapshot.settings, input.workspaceId)
    const policy = snapshot.settings.tapd.writeAccess
    if (!snapshot.settings.projects.some(project => project.id === input.workspaceId && project.enabled && project.available !== false) || !policy?.operations.includes(action)) throw new BusinessError('WRITE_NOT_ALLOWED')
    const fields = Object.keys(input.fields)
    if (!fields.length || fields.some(field => !policy.fields.includes(field) || !writableFields.includes(field as typeof writableFields[number]))) throw new BusinessError('FIELD_NOT_ALLOWED')
    if (action === 'create' && (!input.fields.name?.trim() || 'status' in input.fields)) throw new BusinessError('INVALID_CREATE_FIELDS')
    if (input.fields.name !== undefined && !input.fields.name.trim()) throw new BusinessError('INVALID_TITLE')
    for (const field of ['begin', 'due']) if (input.fields[field] && !isValidDateKey(input.fields[field])) throw new BusinessError('INVALID_DATE_FIELD')
    if (input.fields.begin && input.fields.due && input.fields.begin > input.fields.due) throw new BusinessError('INVALID_DATE_ORDER')
    if (input.fields.effort !== undefined && (input.fields.effort.trim() === '' || !Number.isFinite(Number(input.fields.effort)) || Number(input.fields.effort) < 0)) throw new BusinessError('INVALID_EFFORT')
    if (action === 'update' && (!input.id || !input.expectedDigest)) throw new BusinessError('EXPECTED_DIGEST_REQUIRED')
  }
  async function readItem(input: { workspaceId: string; entityType: EntityType; id: string }) {
    const snapshot = store.readSettings()
    const api = client(snapshot)
    assertProject(snapshot.settings, input.workspaceId)
    const row = await api.getRawItem(input.workspaceId, input.entityType, input.id)
    const project = snapshot.settings.projects.find(project => project.id === input.workspaceId) ?? { id: input.workspaceId, name: input.workspaceId, enabled: true, color: '#3b82f6' }
    return { item: input.entityType === 'story' ? row : { ...row, ...mapScheduleRow(row, project, input.entityType) }, digest: rowDigest(row), workspaceId: input.workspaceId, entityType: input.entityType }
  }
  const matched = (receipt: OperationReceipt, row: RawRow) => Object.entries(receipt.expectedHashes).every(([field, hash]) => fieldHashes({ [field]: row[field] })[field] === hash)
  async function verifyOperation(operationId: string, candidateId?: string) {
    const receipt = files.getOperation(operationId)
    if (!receipt) throw new BusinessError('OPERATION_NOT_FOUND')
    assertProject(store.readSettings().settings, receipt.workspaceId)
    if (receipt.status === 'succeeded' || receipt.status === 'failed' || receipt.status === 'pending' || receipt.status === 'in_flight') return receipt
    const id = receipt.remoteId ?? candidateId
    if (!id) return { ...receipt, next: 'Search the marked remote item, then verify with its candidate ID. Do not resend the write.' }
    const row = await client(store.readSettings()).getRawItem(receipt.workspaceId, receipt.entityType, id)
    if (!matched(receipt, row)) return { ...receipt, code: 'REMOTE_VALUES_DO_NOT_MATCH', candidateId: id }
    invalidateCache()
    return files.updateOperation(operationId, { status: 'succeeded', remoteId: id, code: 'READ_BACK_VERIFIED' })
  }
  async function performWrite(input: WriteInput, action: 'create' | 'update') {
    const snapshot = store.readSettings()
    access(input, action, snapshot)
    const api = client(snapshot)
    // Reserve before asynchronous metadata reads so all clients share the same receipt.
    const canonical = { workspaceId: input.workspaceId, entityType: input.entityType, action, id: input.id ?? null, fields: fieldHashes(input.fields), expectedDigest: input.expectedDigest ?? null, actor: input.actor,
      subject: digest([snapshot.settings.tapd.baseUrl, store.getCredential()]) }
    const reserved = files.reserveOperation({ idempotencyKey: input.idempotencyKey, requestHash: digest(canonical), workspaceId: input.workspaceId, entityType: input.entityType, action,
      actor: `local-user:${input.actor}`, expectedHashes: fieldHashes(input.fields), remoteId: input.id, ...input.batch })
    if (!reserved.fresh) return { ...reserved.receipt, replayed: true }
    const id = reserved.receipt.operationId
    let sent = false
    let acknowledged = false
    try {
      const schema = await api.workspaceSchema(input.workspaceId, input.entityType, input.fields.workitem_type_id)
      if (Object.keys(input.fields).some(field => !schema.writableFields.includes(field as typeof writableFields[number]))) throw new BusinessError('FIELD_NOT_SUPPORTED_FOR_ENTITY')
      if (input.fields.status && !Object.prototype.hasOwnProperty.call(schema.statuses, input.fields.status)) throw new BusinessError('INVALID_STATUS')
      if (input.entityType === 'story' && schema.fields && !Array.isArray(schema.fields)) {
        const fields = schema.fields as Record<string, { readonly?: unknown; options?: unknown }>
        for (const [field, value] of Object.entries(input.fields)) {
          if (Number(fields[field]?.readonly) === 1) throw new BusinessError('READONLY_FIELD')
          const options = fields[field]?.options
          if (['iteration_id', 'workitem_type_id', 'status'].includes(field) && options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).length && value !== '0' && !Object.prototype.hasOwnProperty.call(options, value)) throw new BusinessError('INVALID_FIELD_OPTION')
        }
      }
      if (input.fields.owner) {
        const values = input.fields.owner.split(';').map(value => value.trim()).filter(Boolean)
        for (const value of values) {
          const candidates = schema.members.filter(member => member.user === value || member.user.split('_').at(-1) === value || member.user.replace(/_\d+$/, '') === value)
          if (candidates.length !== 1) throw new BusinessError('IDENTITY_AMBIGUOUS_OR_UNKNOWN', { candidates: candidates.map(candidate => candidate.user) })
          // Names and IDs are discoverable candidates; writes require the exact directory identity.
          if (candidates[0].user !== value) throw new BusinessError('EXACT_IDENTITY_REQUIRED', { candidates: [candidates[0].user] })
        }
      }
      let previous: RawRow | undefined
      if (action === 'update') {
        previous = await api.getRawItem(input.workspaceId, input.entityType, input.id!)
        if (rowDigest(previous) !== input.expectedDigest) throw new BusinessError('ITEM_CONFLICT')
      }
      for (const [field, type] of [['story_id', 'story']] as const) if (input.fields[field] && input.fields[field] !== '0') await api.getRawItem(input.workspaceId, type, input.fields[field])
      const begin = input.fields.begin ?? String(previous?.begin ?? '')
      const due = input.fields.due ?? String(previous?.due ?? '')
      if (begin && due && begin > due) throw new BusinessError('INVALID_DATE_ORDER')
      // Scope can change while metadata is loading. Recheck before emitting a mutation.
      if (store.readSettings().revision !== snapshot.revision) throw new BusinessError('CONFIG_CHANGED')
      files.updateOperation(id, { status: 'in_flight' })
      sent = true
      const row = await api.writeItem(input.workspaceId, input.entityType, input.fields, input.id)
      acknowledged = true
      const remoteId = String(row.id)
      files.updateOperation(id, { status: 'unknown', remoteId, code: 'READ_BACK_PENDING' })
      invalidateCache()
      return await verifyOperation(id, remoteId)
    } catch (error) {
      invalidateCache()
      const definiteFailure = !acknowledged && error instanceof TapdError && error.status < 500 && error.status !== 429
      const status = sent && !definiteFailure ? 'unknown' : 'failed'
      const receipt = files.updateOperation(id, { status, code: error instanceof BusinessError ? error.code : sent ? status === 'unknown' ? 'REMOTE_RESULT_UNKNOWN' : 'TAPD_WRITE_REJECTED' : 'PREWRITE_VALIDATION_FAILED',
        httpStatus: error instanceof TapdError ? error.httpStatus ?? error.status : undefined, businessStatus: error instanceof TapdError ? error.businessStatus : undefined })
      return { ...receipt, ...(error instanceof BusinessError ? error.details : {}) }
    }
  }
  function write(input: WriteInput, action: 'create' | 'update') {
    const promise = performWrite(input, action).catch(error => {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_CONFLICT') throw new BusinessError('IDEMPOTENCY_KEY_CONFLICT')
      throw error
    })
    activeWrites.add(promise)
    void promise.finally(() => activeWrites.delete(promise)).catch(() => {})
    return promise
  }
  function settingsFor(input: AnalysisInput) {
    const snapshot = store.readSettings()
    const today = input.analysisDate ?? businessDate(snapshot.settings.timeZone)
    const range = { start: input.start, end: input.end }
    validateAnalysisInput(range, today)
    const projects = input.projectIds ?? snapshot.settings.projects.filter(project => project.enabled && project.available !== false).map(project => project.id)
    for (const id of projects) assertProject(snapshot.settings, id)
    let selectedMembers: TeamSightSettings['members']
    try { selectedMembers = resolveMemberScope(snapshot.settings, input) } catch(error) { throw new BusinessError((error as Error).message, { next: 'teamsight_open_settings' }) }
    const settings = { ...snapshot.settings, projects: snapshot.settings.projects.filter(project => projects.includes(project.id)).map(project => ({ ...project, enabled: true })),
      members: selectedMembers }
    if (!settings.projects.length || !settings.members.length) throw new BusinessError('CONFIG_REQUIRED', { next: 'teamsight_open_settings' })
    const context: AnalysisContext = { range, analysisDate: today, timeZone: settings.timeZone, projectIds: settings.projects.map(project => project.id), memberIds: settings.members.map(member => member.staffId),
      configRevision: snapshot.revision, calendarVersion: digest(settings.chinaCalendar), rulesVersion: MCP_RULES_VERSION }
    return { snapshot, settings, today, range, context }
  }
  async function analyze(input: AnalysisInput, signal?: AbortSignal): Promise<TeamAnalysis> {
    let configured = settingsFor(input)
    client(configured.snapshot)
    if (configured.settings.chinaCalendar.enabled) {
      for (const year of calendarYearsForRanges([configured.range]).sources) { signal?.throwIfAborted(); await refreshCalendar(year, false) }
      configured = settingsFor(input)
    }
    let { snapshot, settings, today, range, context } = configured
    const generation = cacheGeneration
    const api = client(snapshot)
    // Source identity excludes aliases, member order and computational rules.
    const key = `hours-v2:${digest({ baseUrl: settings.tapd.baseUrl, credential: digest(store.getCredential()),
      projects: settings.projects.map(project => project.id).sort(), members: settings.members.map(member => member.staffId).sort(), completedStates: settings.hours.completedStates, range, today })}`
    const cached = input.refresh ? null : store.getCache(key)
    const source = cached && Date.now() - Date.parse(cached.fetchedAt) <= 60_000
      ? cached.value as { snapshotId: string }
      : null
    const hoursSnapshot = source ? files.getJson<Awaited<ReturnType<typeof fetchHoursSnapshot>>>(source.snapshotId)
      : await fetchHoursSnapshot({ projects: settings.projects, members: settings.members, range, today, settings: settings.hours, accountIdentities: true }, api, { signal })
    signal?.throwIfAborted()
    const snapshotId = source?.snapshotId ?? randomUUID()
    const fetchedAt = new Date(hoursSnapshot.fetchedAt ?? Date.now()).toISOString()
    if (!source) {
      files.putFile('snapshot', JSON.stringify(hoursSnapshot), 'json', 'application/json', {}, snapshotId)
      if (hoursSnapshot.status === 'complete' && generation === cacheGeneration) store.putCache(key, fetchedAt, 'complete', { snapshotId })
    }
    const aliases = new Map(settings.projects.map(project => [project.id, project]))
    const currentSnapshot = { ...hoursSnapshot, tasks: hoursSnapshot.tasks.map(task => ({ ...task, projectName: aliases.get(task.projectId)!.alias || aliases.get(task.projectId)!.name, projectColor: aliases.get(task.projectId)!.color })) }
    if (settings.chinaCalendar.enabled) {
      for (const year of calendarYearsForRanges(calendarTaskRanges(currentSnapshot.tasks, today)).sources) { signal?.throwIfAborted(); await refreshCalendar(year, false) }
      const latest = store.readSettings()
      settings = { ...settings, chinaCalendar: { ...settings.chinaCalendar, years: { ...settings.chinaCalendar.years, ...latest.settings.chinaCalendar.years } } }
      context = { ...context, calendarVersion: digest(settings.chinaCalendar) }
    }
    const members = calculateHours({ snapshot: currentSnapshot, members: settings.members, settings: settings.hours, range, today, calendar: mergeCalendar(settings.chinaCalendar), policy: 'mcp' })
    for (const member of members) for (const day of member.days) day.available = Math.max(day.target - day.actual - day.allocated, 0)
    const limitations = ['工作项覆盖配置成员，未扫描无负责人对象。', '工时单位为小时；需求不与子任务重复汇总。', '当天及未来按实际与剩余分配计算，缺预估有效值为0。', '没有历史快照时不推断排期变化或期间完成量。']
    let calendarIncomplete = false
    if (settings.chinaCalendar.enabled) {
      const required = calendarYearsForRanges([range, ...calendarTaskRanges(currentSnapshot.tasks, today)]).sources
      const missing = required.filter(year => !settings.chinaCalendar.years[String(year)])
      if (missing.length) {
        calendarIncomplete = true
        limitations.push(`缺少中国日历来源 ${missing.join('、')}，对应日期使用普通周历，目标与不足结论待确认。`)
        for (const member of members) for (const day of member.days) {
          if (missing.includes(Number(day.date.slice(0, 4))) || day.date.slice(5, 7) === '12' && missing.includes(Number(day.date.slice(0, 4)) + 1)) {
            day.reasons.push({ message: '中国日历来源不完整，工作日目标待确认' })
            if (day.state === 'short') day.state = 'unknown'
          }
        }
      }
    }
    if (currentSnapshot.status !== 'complete') limitations.push('数据不完整，未知量不补零；缺口不能解释为没有任务或风险。')
    for(const task of currentSnapshot.tasks) {
      const key=hoursTaskKey(task),estimate=parseHours(task.effort)??(!task.effort?0:null),completed=isHoursCompleted(task,settings.hours)
      const unknown=currentSnapshot.issues.some(issue=>issue.taskKey===key&&issue.affects!=='actual')
      const actual=unknown?null:currentSnapshot.records.filter(record=>[record.projectId,record.entityType,record.entityId].join(':')===key&&record.spentDate<=today).reduce((sum,record)=>sum+record.hours,0)
      task.hours={estimate,estimateMissing:!task.effort,actual,actualCoverage:completed?'period':'cumulative',remaining:completed?0:estimate===null||actual===null?null:Math.max(estimate-actual,0)}
    }
    const analysis: TeamAnalysis = { analysisId: randomUUID(), snapshotId, createdAt: new Date().toISOString(), fetchedAt, context, status: currentSnapshot.status === 'failed' ? 'failed' : calendarIncomplete ? 'partial' : currentSnapshot.status, unit: 'hours',
      snapshot: currentSnapshot, members, risks: checkRisks(currentSnapshot, members, settings, today, 'mcp'), limitations }
    files.putFile('analysis', JSON.stringify(analysis), 'json', 'application/json', { snapshotId, analysisId: analysis.analysisId }, analysis.analysisId)
    return analysis
  }
  function getAnalysis(id: string) {
    if (files.getFile(id).kind !== 'analysis') throw new BusinessError('ANALYSIS_NOT_FOUND')
    return files.getJson<TeamAnalysis>(id)
  }
  async function schedule(input: { start: string; end: string; types?: WorkItemType[]; refresh?: boolean }) {
    const snapshot = store.readSettings(), api = client(snapshot), generation = cacheGeneration
    const range = { start: input.start, end: input.end }
    validateAnalysisInput(range, businessDate(snapshot.settings.timeZone))
    const projects = snapshot.settings.projects.filter(project => project.enabled && project.available !== false)
    if (!projects.length) throw new BusinessError('CONFIG_REQUIRED')
    const types = input.types ?? snapshot.settings.tapd.defaultTypes
    if (!types.length) throw new BusinessError('CONFIG_REQUIRED')
    const key = `schedule-p1b:${snapshot.revision}:${input.start}:${input.end}:${[...types].sort().join(',')}`
    const cached = input.refresh ? null : store.getCache(key)
    if (cached && Date.now() - Date.parse(cached.fetchedAt) <= 60_000) return { ...files.getJson<object>((cached.value as { snapshotId: string }).snapshotId), cacheHit: true }
    const tasks: ReturnType<typeof dedupeScheduleTasks> = [], errors: unknown[] = []
    let successful = 0, fetchedAt = Infinity
    for (const project of projects) {
      assertProject(snapshot.settings, project.id)
      for (const type of types) {
        const page = await api.pages(entityPath(type) as '/tasks' | '/bugs', { workspace_id: project.id, fields: fieldsFor(type), begin: `1970-01-01~${input.end}`, due: `${input.start}~2999-12-31` }, entityKey(type))
        fetchedAt = Math.min(fetchedAt, page.fetchedAt)
        if (page.complete) successful++
        else errors.push({ projectId: project.id, type, message: page.error, httpStatus: page.httpStatus, businessStatus: page.businessStatus })
        for (const row of page.rows) {
          const task = mapScheduleRow(row, project, type, Object.fromEntries(snapshot.settings.members.map(member => [member.staffId, member.name])))
          if (task) tasks.push(task)
          else errors.push({ projectId: project.id, type, message: 'MISSING_ITEM_ID' })
        }
      }
    }
    const value = { status: errors.length ? successful || tasks.length ? 'partial' : 'failed' : 'complete', fetchedAt: new Date(fetchedAt).toISOString(), range, tasks: dedupeScheduleTasks(tasks), errors,
      coverage: { projectIds: projects.map(project => project.id), types, includesMissingDates: false }, unit: 'hours', rulesVersion: RULES_VERSION }
    if (value.status === 'complete' && generation === cacheGeneration) {
      const saved = files.putFile('snapshot', JSON.stringify(value), 'json', 'application/json')
      store.putCache(key, value.fetchedAt, 'complete', { snapshotId: saved.id })
    }
    return value
  }
  function startAnalysis(input: AnalysisInput) {
    settingsFor(input)
    client(store.readSettings())
    if (running.size >= 3) throw new BusinessError('JOB_LIMIT')
    const jobId = randomUUID(), controller = new AbortController()
    const initial: JobRecord = { jobId, status: 'running', createdAt: new Date().toISOString() }
    files.putJob(initial)
    const promise = analyze(input, controller.signal).then(analysis => {
      files.putJob({ ...initial, status: 'completed', analysisId: analysis.analysisId })
      return analysis
    }).catch(error => { files.putJob({ ...initial, status: controller.signal.aborted ? 'cancelled' : 'failed', code: knownCode(error) }) }).finally(() => running.delete(jobId))
    running.set(jobId, { controller, promise })
    return initial
  }
  async function analyzeWithBudget(input: AnalysisInput) {
    const initial = startAnalysis(input)
    const done = running.get(initial.jobId)!.promise.then(() => files.getJob(initial.jobId)!)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([done, new Promise<typeof initial>(resolve => { timer = setTimeout(() => resolve(initial), 2000) })])
    } finally { clearTimeout(timer) }
  }
  async function close() {
    for (const job of running.values()) job.controller.abort(new Error('SERVICE_STOPPING'))
    await Promise.allSettled([...running.values()].map(job => job.promise).concat([...activeWrites]))
  }
  return { files, client, assertProject, readItem, write, verifyOperation, analyze, analyzeWithBudget, schedule, getAnalysis, startAnalysis, refreshCalendar,
    cancelJob: (id: string) => { const job = files.getJob(id); if (!job) throw new BusinessError('JOB_NOT_FOUND'); running.get(id)?.controller.abort(new Error('CANCELLED')); return job }, close }
}
export type TeamSightBusiness = ReturnType<typeof createBusiness>
