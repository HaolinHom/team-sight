import { TapdError, RequestQueue, type EntityType, type PageResult, type Project, type SearchInput, type SearchResult, type TapdClientOptions, type TapdEnvelope, type TapdTransport } from './types.js'
import { fieldsFor, mapRows, mapSingleRow, rowsOf } from './mapper.js'
import { isValidDateKey, type RawRow } from '@teamsight/core'
import { entityKey, entityPath, writableFields } from './operations.js'

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return }
  const aborted = () => { clearTimeout(timer); reject(signal?.reason) }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve() }, ms)
  signal?.addEventListener('abort', aborted, { once: true })
})

export class TapdClient {
  private readonly transport: TapdTransport
  private readonly queue: RequestQueue
  constructor(private readonly options: TapdClientOptions) {
    this.queue = options.queue ?? new RequestQueue()
    this.transport = options.transport ?? ((path, params, signal, request) => this.fetchTransport(path, params, signal, request?.method))
  }

  private async fetchTransport(path: string, params: Record<string, string>, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<TapdEnvelope> {
    const token = this.options.getToken()
    if (!token) throw new TapdError('TAPD 凭据未配置', 401)
    const url = new URL(path, this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`)
    if (method === 'GET') for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? new URLSearchParams(params) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), redirect: 'error' })
    let body: unknown
    try { body = await response.json() } catch { body = {} }
    const envelope = body && typeof body === 'object' ? body as TapdEnvelope : { status: response.status, data: body, info: response.statusText }
    if (!response.ok) throw new TapdError(`TAPD HTTP ${response.status}`, response.status, response.status, envelope.status,
      response.status === 401 || response.status === 422 && /access token|token.*invalid/i.test(envelope.info ?? '') ? 'CONFIG_REQUIRED' : response.status === 422 ? 'TAPD_VALIDATION_FAILED' : 'TAPD_REQUEST_FAILED')
    return { ...envelope, httpStatus: response.status }
  }

  private async request(path: string, params: Record<string, string>, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<TapdEnvelope> {
    let last: unknown
    const attempts = method === 'GET' ? 3 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        signal?.throwIfAborted()
        const envelope = await this.queue.run(() => this.transport(path, params, signal, { method }))
        if (!Number.isFinite(envelope.status)) throw new Error('INVALID_TAPD_RESPONSE')
        if (envelope.status !== 1) throw new TapdError(`TAPD business status ${envelope.status}`, envelope.status, envelope.httpStatus, envelope.status)
        return envelope
      } catch (error) {
        last = error
        if (signal?.aborted || error instanceof TapdError && error.status < 500 && error.status !== 429) throw error
        if (attempt < attempts - 1) await delay(150 * (attempt + 1), signal)
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }

  async listProjects(signal?: AbortSignal): Promise<Project[]> {
    const envelope = await this.request('/workspaces/user_participant_projects', {}, signal)
    const data = Array.isArray(envelope.data) ? envelope.data : []
    return data.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).Workspace : null)
      .filter((row): row is RawRow => Boolean(row) && typeof row === 'object')
      .map(row => ({ id: String(row.id ?? ''), name: String(row.name ?? ''), enabled: false, color: '#3b82f6', tapdStatus: String(row.status ?? '') }))
      .filter(project => project.id.length > 0)
  }

  async searchItems(input: SearchInput, project: Project, members: Record<string, string> = {}, signal?: AbortSignal): Promise<SearchResult> {
    const path = input.entityType === 'task' ? '/tasks' : '/bugs'
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
    const params: Record<string, string> = {
      workspace_id: input.workspaceId,
      fields: fieldsFor(input.entityType),
      limit: String(limit),
      page: String(Math.max(input.page ?? (input.offset ? Math.floor(input.offset / limit) + 1 : 1), 1)),
    }
    if (input.keyword?.trim()) params[input.entityType === 'task' ? 'name' : 'title'] = input.keyword.trim()
    if (input.status?.trim()) params.status = input.status.trim()
    if (input.owner) params[input.entityType === 'task' ? 'owner' : 'current_owner'] = input.owner
    if (input.storyId) params.story_id = input.storyId
    if (input.modified) params.modified = input.modified.start + '~' + input.modified.end
    if (input.range) {
      params.begin = `1970-01-01~${input.range.end}`
      params.due = `${input.range.start}~2999-12-31`
    }
    const envelope = await this.request(path, params, signal)
    const tasks = mapRows(rowsOf(envelope.data, input.entityType), project, input.entityType, members)
    const totalValue = envelope.data && typeof envelope.data === 'object' ? Number((envelope.data as Record<string, unknown>).count) : NaN
    return { tasks, total: Number.isFinite(totalValue) ? totalValue : undefined, partial: tasks.length >= limit, errors: [] }
  }

  async getItem(input: { workspaceId: string; entityType: 'task' | 'bug'; id: string }, project: Project, members: Record<string, string> = {}, signal?: AbortSignal): Promise<ReturnType<typeof mapSingleRow>> {
    const row = await this.getRawItem(input.workspaceId, input.entityType, input.id, signal)
    return mapSingleRow(row, project, input.entityType, members)
  }

  async getRawItem(workspaceId: string, type: EntityType, id: string, signal?: AbortSignal): Promise<RawRow> {
    const envelope = await this.request(entityPath(type), { workspace_id: workspaceId, id, limit: '2' }, signal)
    const data = Array.isArray(envelope.data) ? envelope.data : [envelope.data]
    const matches = data.map(item => item && typeof item === 'object' ? (item as RawRow)[entityKey(type)] : null)
      .filter((row): row is RawRow => !!row && typeof row === 'object' && String((row as RawRow).id) === id)
    if (matches.length !== 1 || matches[0].workspace_id && String(matches[0].workspace_id) !== workspaceId) throw new TapdError('ITEM_NOT_FOUND_OR_AMBIGUOUS', 404)
    return matches[0]
  }

  async searchRaw(workspaceId: string, type: EntityType, options: { keyword?: string; status?: string; owner?: string; storyId?: string; range?: import('@teamsight/core').DateRange; modified?: import('@teamsight/core').DateRange; limit?: number; page?: number; offset?: number } = {}, signal?: AbortSignal) {
    const limit = options.limit ?? 50
    const params: Record<string, string> = { workspace_id: workspaceId, limit: String(limit), page: String(options.page ?? (options.offset ? Math.floor(options.offset / limit) + 1 : 1)) }
    if (options.keyword) params[type === 'bug' ? 'title' : 'name'] = options.keyword
    if (options.status) params.status = options.status
    if (options.owner) params[type === 'bug' ? 'current_owner' : 'owner'] = options.owner
    if (options.storyId) params.story_id = options.storyId
    if (options.range) { params.begin = '1970-01-01~' + options.range.end; params.due = options.range.start + '~2999-12-31' }
    if (options.modified) params.modified = options.modified.start + '~' + options.modified.end
    const envelope = await this.request(entityPath(type), params, signal)
    if (!Array.isArray(envelope.data)) throw new TapdError('INVALID_LIST_RESPONSE', 0, envelope.httpStatus, envelope.status)
    return envelope.data.map(item => (item as RawRow)?.[entityKey(type)]).filter((row): row is RawRow => !!row && typeof row === 'object')
  }

  async pages(path: '/tasks' | '/bugs' | '/stories' | '/timesheets' | '/workspaces/users' | '/story_changes' | '/task_changes' | '/attachments', params: Record<string, string>, key: string, signal?: AbortSignal, pageSize = path.endsWith('_changes') ? 100 : 200): Promise<PageResult> {
    const rows: RawRow[] = [], seen = new Set<string>()
    let expected = Infinity, fetchedAt = Infinity
    for (let page = 1; page <= 50; page++) {
      try {
        const envelope = await this.request(path, { ...params, limit: String(pageSize), page: String(page), ...(path==='/attachments'?{}:{order: 'id asc'}) }, signal)
        fetchedAt = Math.min(fetchedAt, Date.now())
        if (!Array.isArray(envelope.data)) throw new Error('INVALID_LIST_RESPONSE')
        const entries = envelope.data.map(item => (item as RawRow)?.[key])
        if (entries.some(entry => !entry || typeof entry !== 'object')) throw new Error('INVALID_LIST_ROW')
        for (const entry of entries as RawRow[]) {
          const id = String(entry[key === 'UserWorkspace' ? 'user' : 'id'] ?? '')
          if (!id || seen.has(id)) throw new Error('REPEATED_OR_MISSING_PAGE_ID')
          seen.add(id); rows.push(entry)
        }
        if (page === 1 && entries.length === pageSize && !['/workspaces/users','/story_changes','/task_changes','/attachments'].includes(path)) {
          try {
            const count = await this.request(`${path}/count`, params, signal)
            const value = Number((count.data as RawRow)?.count)
            if (Number.isSafeInteger(value) && value >= rows.length) expected = value
          } catch { signal?.throwIfAborted() }
        }
        if (entries.length < pageSize && Number.isFinite(expected) && rows.length < expected) return { rows, complete: false, fetchedAt, error: 'COUNT_MISMATCH_OR_TRUNCATED_PAGE' }
        if (entries.length < pageSize || rows.length >= expected) return { rows, complete: true, fetchedAt }
      } catch (error) {
        signal?.throwIfAborted()
        return { rows, complete: false, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(), error: error instanceof Error ? error.message : 'TAPD_REQUEST_FAILED',
          httpStatus: error instanceof TapdError ? error.httpStatus ?? error.status : undefined, businessStatus: error instanceof TapdError ? error.businessStatus : undefined }
      }
    }
    return { rows, complete: false, fetchedAt, error: 'PAGE_BUDGET_EXCEEDED_50' }
  }

  async currentUser() {
    const value = await this.request('/users/info', {})
    if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new TapdError('INVALID_USER_INFO', 0)
    return value.data as RawRow
  }
  async members(workspaceId: string) { return this.pages('/workspaces/users', { workspace_id: workspaceId }, 'UserWorkspace') }
  async storyHistory(workspaceId: string, id: string) {
    const result=await this.pages('/story_changes', { workspace_id: workspaceId, story_id: id }, 'WorkitemChange')
    return result.rows.some(row=>String(row.story_id)!==id)?{...result,complete:false,error:'HISTORY_FILTER_MISMATCH',rows:result.rows.filter(row=>String(row.story_id)===id)}:result
  }

  async taskHistory(workspaceId: string, ids: string[]) {
    const result=await this.pages('/task_changes', { workspace_id: workspaceId, task_id: ids.join(',') }, 'WorkitemChange')
    return result.rows.some(row=>!ids.includes(String(row.task_id)))?{...result,complete:false,error:'HISTORY_FILTER_MISMATCH',rows:result.rows.filter(row=>ids.includes(String(row.task_id)))}:result
  }
  async attachments(workspaceId: string, entryId: string) { return this.pages('/attachments', { workspace_id: workspaceId, entry_id: entryId }, 'Attachment') }
  async attachmentLink(workspaceId: string, id: string) {
    const response=await this.request('/attachments/down',{workspace_id:workspaceId,id})
    const row=(response.data as RawRow)?.Attachment as RawRow|undefined
    if(!row || String(row.id)!==id || String(row.workspace_id)!==workspaceId || typeof row.download_url!=='string') throw new TapdError('INVALID_ATTACHMENT_RESPONSE',0)
    return {attachment:row,fetchedAt:new Date().toISOString(),expiresAfterSeconds:300}
  }

  async workspaceSchema(workspaceId: string, type: 'story' | 'task', workitemTypeId?: string) {
    const users = await this.pages('/workspaces/users', { workspace_id: workspaceId }, 'UserWorkspace')
    if (!users.complete) throw new TapdError('MEMBER_DIRECTORY_INCOMPLETE', 0)
    const params: Record<string, string> = { workspace_id: workspaceId }
    if (workitemTypeId) params.workitem_type_id = workitemTypeId
    const metadata = await this.request(type === 'story' ? '/stories/get_fields_info' : '/tasks/custom_fields_settings', params)
    return { workspaceId, entityType: type, members: users.rows.map(row => ({ user: String(row.user ?? '') })),
      fields: metadata.data, writableFields: writableFields.filter(field => type === 'story' ? field !== 'story_id' : field !== 'workitem_type_id'),
      statuses: type === 'task' ? { open: '未开始', progressing: '进行中', done: '已完成' } : ((metadata.data as Record<string, { options?: unknown }>)?.status?.options ?? {}),
      statusSource: type === 'task' ? 'documented-task-states' : 'project-metadata', fetchedAt: new Date().toISOString() }
  }

  async count(type: EntityType | 'timesheets', workspaceId: string) {
    const envelope = await this.request(type === 'timesheets' ? '/timesheets/count' : `${entityPath(type)}/count`, { workspace_id: workspaceId })
    const count = Number((envelope.data as RawRow)?.count)
    if (!Number.isSafeInteger(count) || count < 0) throw new TapdError('INVALID_COUNT', 0)
    return { workspaceId, count, httpStatus: envelope.httpStatus, businessStatus: envelope.status }
  }

  async writeItem(workspaceId: string, type: 'story' | 'task', fields: Record<string, string>, id?: string): Promise<RawRow> {
    if (!Object.keys(fields).length || Object.keys(fields).some(field => !writableFields.includes(field as typeof writableFields[number]))) throw new Error('FIELD_NOT_ALLOWED')
    if (!id && (!fields.name?.trim() || fields.status)) throw new Error('INVALID_CREATE_FIELDS')
    for (const field of ['begin', 'due']) if (fields[field] && !isValidDateKey(fields[field])) throw new Error('INVALID_DATE_FIELD')
    const envelope = await this.request(entityPath(type), { ...fields, workspace_id: workspaceId, ...(id ? { id } : {}) }, undefined, 'POST')
    const row = (envelope.data as RawRow)?.[entityKey(type)]
    if (!row || typeof row !== 'object' || !(row as RawRow).id) throw new Error('WRITE_RESPONSE_UNCONFIRMED')
    return row as RawRow
  }
}

export { TapdError } from './types.js'
