import type { ScheduleTask } from '@/types/schedule';

import { resolveDateIssue } from './layout';

/** 任务条提示内容：字段全部来自真实任务数据，不做任何推算。 */
export interface GanttTooltipContent {
  title: string;
  project: string;
  status: string;
  priority: string;
  assignee: string;
  dateRange: string;
  notes: string[];
}

export interface TooltipBuildOptions {
  clippedStart?: boolean;
  clippedEnd?: boolean;
}

const DATE_ISSUE_NOTES: Record<string, string> = {
  'missing-both': '缺少开始与截止日期，未在日历上生成任务条',
  'missing-start': '缺少开始日期，未在日历上生成任务条',
  'missing-due': '缺少截止日期，未在日历上生成任务条',
  reversed: '开始日期晚于截止日期，数据异常，未生成任务条',
};

function formatDateRange(startDate: string | null, dueDate: string | null): string {
  if (startDate && dueDate) return `${startDate} ~ ${dueDate}`;
  if (dueDate) return `仅截止日：${dueDate}`;
  if (startDate) return `仅开始日：${startDate}`;
  return '无日期';
}

export function buildTooltipContent(
  task: ScheduleTask,
  options: TooltipBuildOptions = {}
): GanttTooltipContent {
  const notes: string[] = [];
  const issue = resolveDateIssue(task);
  if (issue) notes.push(DATE_ISSUE_NOTES[issue]);

  if (options.clippedStart || options.clippedEnd) {
    notes.push('已按当前时间范围裁剪显示，原始日期不变');
  }

  return {
    title: task.title || '(无标题)',
    project: task.projectName || task.projectId,
    status: task.status || '未知',
    priority: task.priority ?? '',
    assignee: task.assigneeName?.trim() || '未分配',
    dateRange: formatDateRange(task.startDate, task.dueDate),
    notes,
  };
}
