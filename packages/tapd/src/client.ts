import { TapdError, type Project, type SearchInput, type SearchResult, type TapdClientOptions, type TapdEnvelope, type TapdTransport } from './types.js'
import { fieldsFor, mapRows, mapSingleRow, rowsOf } from './mapper.js'
import type { RawRow } from '@teamsight/core'

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return }
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

export class TapdClient {
  private readonly transport: TapdTransport
  constructor(private readonly options: TapdClientOptions) {
    this.transport = options.transport ?? ((path, params, signal) => this.fetchTransport(path, params, signal))
  }

  private async fetchTransport(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<TapdEnvelope> {
    const token = this.options.getToken()
    if (!token) throw new TapdError('TAPD 凭据未配置', 401)
    const url = new URL(path, this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal })
    let body: unknown
    try { body = await response.json() } catch { body = {} }
    const envelope = body && typeof body === 'object' ? body as TapdEnvelope : { status: response.status, data: body, info: response.statusText }
    if (!response.ok) throw new TapdError(envelope.info || `TAPD HTTP ${response.status}`, response.status)
    return envelope
  }

  private async request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<TapdEnvelope> {
    let last: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const envelope = await this.transport(path, params, signal)
        if (envelope.status !== 1) throw new TapdError(envelope.info || 'TAPD 返回错误', envelope.status)
        return envelope
      } catch (error) {
        last = error
        if (error instanceof TapdError && error.status < 500) throw error
        if (attempt < 2) await delay(150 * (attempt + 1), signal)
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
    if (input.range) {
      params.begin = `1970-01-01~${input.range.end}`
      params.due = `${input.range.start}~2999-12-31`
    }
    const envelope = await this.request(path, params, signal)
    const tasks = mapRows(rowsOf(envelope.data, input.entityType), project, input.entityType, members)
    const totalValue = envelope.data && typeof envelope.data === 'object' ? Number((envelope.data as Record<string, unknown>).count) : NaN
    return { tasks, total: Number.isFinite(totalValue) ? totalValue : undefined, partial: tasks.length >= 200, errors: [] }
  }

  async getItem(input: { workspaceId: string; entityType: 'task' | 'bug'; id: string }, project: Project, members: Record<string, string> = {}, signal?: AbortSignal): Promise<ReturnType<typeof mapSingleRow>> {
    const path = input.entityType === 'task' ? `/tasks/${encodeURIComponent(input.id)}` : `/bugs/${encodeURIComponent(input.id)}`
    const envelope = await this.request(path, { workspace_id: input.workspaceId, fields: fieldsFor(input.entityType) }, signal)
    const data = envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : {}
    const row = data[input.entityType === 'task' ? 'Task' : 'Bug']
    return row && typeof row === 'object' ? mapSingleRow(row as RawRow, project, input.entityType, members) : null
  }
}

export { TapdError } from './types.js'
