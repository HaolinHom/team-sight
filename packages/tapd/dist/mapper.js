import { buildTapdUrl, mapScheduleRow } from '@teamsight/core';
export const fieldsFor = (type) => type === 'task'
    ? 'id,name,workspace_id,owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,completed'
    : 'id,title,workspace_id,current_owner,creator,status,priority_label,effort,begin,due,iteration_id,created,modified,closed';
export function rowsOf(data, type) {
    if (!Array.isArray(data))
        return [];
    const key = type === 'task' ? 'Task' : 'Bug';
    return data.map(item => item && typeof item === 'object' ? item[key] : null)
        .filter((row) => Boolean(row) && typeof row === 'object');
}
export function mapRows(rows, project, type, members = {}) {
    return rows.map(row => mapScheduleRow(row, project, type, members)).filter((task) => Boolean(task));
}
export function mapSingleRow(row, project, type, members = {}) {
    return mapScheduleRow(row, project, type, members);
}
export { buildTapdUrl };
