import type { DateRange, ProjectConfig, ScheduleTask, WorkItemType } from '@teamsight/core'

export interface TapdEnvelope<T = unknown> { status: number; data: T; info: string; httpStatus?: number }
export class TapdError extends Error {
  constructor(message: string, readonly status: number, readonly httpStatus?: number, readonly businessStatus?: number, readonly code = 'TAPD_REQUEST_FAILED') {
    super(message)
    this.name = 'TapdError'
  }
}
export type TapdTransport = (path: string, params: Record<string, string>, signal?: AbortSignal, request?: { method: 'GET' | 'POST' }) => Promise<TapdEnvelope>
export interface SearchInput { workspaceId: string; entityType: WorkItemType; keyword?: string; status?: string; limit?: number; offset?: number; page?: number; range?: DateRange }
export interface TapdQueryError { status: number; message: string }
export interface SearchResult { tasks: ScheduleTask[]; total?: number; partial: boolean; errors: TapdQueryError[] }
export interface TapdClientOptions { baseUrl: string; getToken: () => string | null; transport?: TapdTransport; queue?: RequestQueue }
export type Project = ProjectConfig & { tapdStatus?: string }

/** Shared by every connection and adapter in a service instance. */
export class RequestQueue {
  private active = 0
  private waiting: Array<() => void> = []
  constructor(private readonly concurrency = 3) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      const enter = () => { this.active++; resolve() }
      if (this.active < this.concurrency) enter()
      else this.waiting.push(enter)
    })
    try { return await fn() }
    finally { this.active--; this.waiting.shift()?.() }
  }
}

export interface PageResult { rows: import('@teamsight/core').RawRow[]; complete: boolean; fetchedAt: number; error?: string; httpStatus?: number; businessStatus?: number }
export type EntityType = 'story' | 'task' | 'bug'
