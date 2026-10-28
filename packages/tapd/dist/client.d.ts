import { type Project, type SearchInput, type SearchResult, type TapdClientOptions } from './types.js';
import { mapSingleRow } from './mapper.js';
export declare class TapdClient {
    private readonly options;
    private readonly transport;
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
}
export { TapdError } from './types.js';
