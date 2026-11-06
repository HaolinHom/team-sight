import type { ScheduleTask, HoursSettings } from './types.js'

export const DEFAULT_COMPLETED_STATES = ['done', 'closed', 'resolved', 'rejected'];
export function isHoursCompleted(task: ScheduleTask, settings: HoursSettings): boolean {
  const extra = settings.completedStates.filter(item => item.projectId === task.projectId && item.type === task.sourceType).flatMap(item => item.values);
  return [...DEFAULT_COMPLETED_STATES, ...extra].some(value => value.toLowerCase() === task.status.trim().toLowerCase());
}
