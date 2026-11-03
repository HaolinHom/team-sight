import { type EntityType, type PageResult, type Project, type SearchInput, type SearchResult, type TapdClientOptions } from './types.js';
import { mapSingleRow } from './mapper.js';
import { type RawRow } from '@teamsight/core';
export declare class TapdClient {
    private readonly options;
    private readonly transport;
    private readonly queue;
    constructor(options: TapdClientOptions);
    private fetchTransport;
    private request;
    listProjects(signal?: AbortSignal): Promise<Project[]>;
    searchItems(input: SearchInput, project: Project, members?: Record<string, string>, signal?: AbortSignal): Promise<SearchResult>;
    getItem(input: {
        workspaceId: string;
        entityType: 'task' | 'bug';
        id: string;
    }, project: Project, members?: Record<string, string>, signal?: AbortSignal): Promise<ReturnType<typeof mapSingleRow>>;
    getRawItem(workspaceId: string, type: EntityType, id: string, signal?: AbortSignal): Promise<RawRow>;
    searchRaw(workspaceId: string, type: EntityType, options?: {
        keyword?: string;
        status?: string;
        limit?: number;
        page?: number;
        offset?: number;
    }, signal?: AbortSignal): Promise<RawRow[]>;
    pages(path: '/tasks' | '/bugs' | '/stories' | '/timesheets' | '/workspaces/users', params: Record<string, string>, key: string, signal?: AbortSignal): Promise<PageResult>;
    workspaceSchema(workspaceId: string, type: 'story' | 'task', workitemTypeId?: string): Promise<{
        workspaceId: string;
        entityType: "task" | "story";
        members: {
            user: string;
        }[];
        fields: unknown;
        writableFields: ("status" | "name" | "description" | "owner" | "begin" | "due" | "effort" | "story_id" | "iteration_id" | "workitem_type_id")[];
        statuses: {};
        statusSource: string;
        fetchedAt: string;
    }>;
    count(type: EntityType | 'timesheets', workspaceId: string): Promise<{
        workspaceId: string;
        count: number;
        httpStatus: number | undefined;
        businessStatus: number;
    }>;
    writeItem(workspaceId: string, type: 'story' | 'task', fields: Record<string, string>, id?: string): Promise<RawRow>;
}
export { TapdError } from './types.js';
