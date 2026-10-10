/** 工作项来源类型：TAPD 任务 / TAPD 缺陷。 */
export type WorkItemType = 'task' | 'bug';

/** 日期问题标记，用于把异常数据显式暴露给界面，而不是静默修正。 */
export type DateIssue = 'missing-both' | 'missing-start' | 'missing-due' | 'reversed';

export interface ProjectConfig {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
}

/**
 * 统一排期任务模型。
 * 日期一律为 `YYYY-MM-DD` 自然日字符串，不做时区换算。
 */
export interface ScheduleTask {
  id: string;
  sourceType: WorkItemType;
  title: string;

  projectId: string;
  projectName: string;
  projectColor: string;

  assigneeId: string | null;
  assigneeName: string;
  /** 全部负责人工号（多负责人任务按 TAPD 返回顺序），用于按配置成员归属与拆行。 */
  assigneeIds: string[];

  startDate: string | null;
  dueDate: string | null;
  dateIssue?: DateIssue;

  status: string;
  priority?: string;

  tapdUrl: string;
  rawStatus?: string;
}

/** 成员展示名索引：工号 -> 姓名。 */
export type MemberDirectory = Record<string, string>;
