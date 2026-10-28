import type { DateRange, ProjectConfig, ScheduleTask, WorkItemType } from '@teamsight/core'

export interface TapdEnvelope<T = unknown> { status: number; data: T; info: string }
export class TapdError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'TapdError'
  }
}
export type TapdTransport = (path: string, params: Record<string, string>, signal?: AbortSignal) => Promise<TapdEnvelope>
export interface SearchInput { workspaceId: string; entityType: WorkItemType; keyword?: string; status?: string; limit?: number; offset?: number; page?: number; range?: DateRange }
export interface TapdQueryError { status: number; message: string }
export interface SearchResult { tasks: ScheduleTask[]; total?: number; partial: boolean; errors: TapdQueryError[] }
export interface TapdClientOptions { baseUrl: string; getToken: () => string | null; transport?: TapdTransport }
export type Project = ProjectConfig & { tapdStatus?: string }
