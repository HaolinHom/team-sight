import { buildTapdUrl, type ProjectConfig, type RawRow, type ScheduleTask, type WorkItemType } from '@teamsight/core';
export declare const fieldsFor: (type: WorkItemType) => "id,name,story_id,description,workspace_id,owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,completed" | "id,title,story_id,description,workspace_id,current_owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,closed";
export declare function rowsOf(data: unknown, type: WorkItemType): RawRow[];
export declare function mapRows(rows: RawRow[], project: ProjectConfig, type: WorkItemType, members?: Record<string, string>): ScheduleTask[];
export declare function mapSingleRow(row: RawRow, project: ProjectConfig, type: WorkItemType, members?: Record<string, string>): ScheduleTask | null;
export { buildTapdUrl };
