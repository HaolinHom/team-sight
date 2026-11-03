import type { DateRange, ProjectConfig, ScheduleTask, WorkItemType } from '@teamsight/core';
export interface TapdEnvelope<T = unknown> {
    status: number;
    data: T;
    info: string;
    httpStatus?: number;
}
export declare class TapdError extends Error {
    readonly status: number;
    readonly httpStatus?: number | undefined;
    readonly businessStatus?: number | undefined;
    readonly code: string;
    constructor(message: string, status: number, httpStatus?: number | undefined, businessStatus?: number | undefined, code?: string);
}
export type TapdTransport = (path: string, params: Record<string, string>, signal?: AbortSignal, request?: {
    method: 'GET' | 'POST';
}) => Promise<TapdEnvelope>;
export interface SearchInput {
    workspaceId: string;
    entityType: WorkItemType;
    keyword?: string;
    status?: string;
    owner?: string;
    storyId?: string;
    modified?: DateRange;
    limit?: number;
    offset?: number;
    page?: number;
    range?: DateRange;
}
export interface TapdQueryError {
    status: number;
    message: string;
}
export interface SearchResult {
    tasks: ScheduleTask[];
    total?: number;
    partial: boolean;
    errors: TapdQueryError[];
}
export interface TapdClientOptions {
    baseUrl: string;
    getToken: () => string | null;
    transport?: TapdTransport;
    queue?: RequestQueue;
}
export type Project = ProjectConfig & {
    tapdStatus?: string;
};
/** Shared by every connection and adapter in a service instance. */
export declare class RequestQueue {
    private readonly concurrency;
    private active;
    private waiting;
    constructor(concurrency?: number);
    run<T>(fn: () => Promise<T>): Promise<T>;
}
export interface PageResult {
    rows: import('@teamsight/core').RawRow[];
    complete: boolean;
    fetchedAt: number;
    error?: string;
    httpStatus?: number;
    businessStatus?: number;
}
export type EntityType = 'story' | 'task' | 'bug';
