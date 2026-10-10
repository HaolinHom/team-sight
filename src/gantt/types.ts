export interface GanttLayoutConfig {
  headerHeight: number;
  memberRowHeight: number;
  taskRowHeight: number;
  dayColumnWidth: number;
  labelColumnWidth: number;
  barHeight: number;
}

export type GanttRow =
  | {
      type: 'member';
      key: string;
      memberKey: string;
      memberName: string;
      taskCount: number;
      y: number;
      height: number;
    }
  | {
      type: 'task';
      key: string;
      taskId: string;
      memberKey: string;
      title: string;
      y: number;
      height: number;
    };

export interface GanttBar {
  key: string;
  taskId: string;
  memberKey: string;
  title: string;
  projectId: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startDate: string;
  dueDate: string;
  /** 任务区间被时间窗裁剪的标记，原始日期不因此改变。 */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface GanttMemberGroup {
  key: string;
  memberId: string | null;
  memberName: string;
  tasks: import('@/types/schedule').ScheduleTask[];
}

export interface GanttLayout {
  config: GanttLayoutConfig;
  days: string[];
  rows: GanttRow[];
  bars: GanttBar[];
  memberGroups: GanttMemberGroup[];
  totalWidth: number;
  totalHeight: number;
  todayX: number | null;
  /** 未参与日历绘制的任务（缺失日期 / 日期倒挂），仅用于标签列提示。 */
  unscheduledTaskIds: string[];
}
