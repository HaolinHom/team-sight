import type { EntityType } from './types.js';
export declare const entityPath: (type: EntityType) => string;
export declare const entityKey: (type: EntityType) => string;
export declare const writableFields: readonly ["name", "description", "owner", "begin", "due", "effort", "status", "story_id", "iteration_id", "workitem_type_id"];
export interface OperationDefinition {
    id: string;
    method: 'GET' | 'POST';
    path: string;
    kind: 'read' | 'write';
    encoding: 'query' | 'form';
    pagination: 'page-200-max-50' | 'none';
    responseKey: string;
    documentation: string;
    support: 'implemented';
    inputSchema: Record<string, unknown>;
}
export declare const operations: OperationDefinition[];
export declare function describeOperation(id: string): OperationDefinition;
