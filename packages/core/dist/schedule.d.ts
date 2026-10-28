import type { ProjectConfig, ScheduleTask, WorkItemType } from './types.js';
export type RawRow = Record<string, unknown>;
export declare function normalizeDateKey(value: unknown): string | null;
export declare function parseAssignees(value: unknown): Array<{
    id: string | null;
    name: string;
}>;
export declare function buildTapdUrl(workspaceId: string, type: WorkItemType, id: string): string;
export declare function mapScheduleRow(row: RawRow, project: ProjectConfig, type: WorkItemType, members?: Record<string, string>): ScheduleTask | null;
export declare function dedupeScheduleTasks(tasks: ScheduleTask[]): ScheduleTask[];
