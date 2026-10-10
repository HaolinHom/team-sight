# TeamSight 阶段3 实施方案：筛选、完成态视觉与工时字段

## Summary

- 目标：按技术方案阶段3 交付日常使用所需的筛选与查看能力——自定义时间范围、项目/成员/状态多选筛选，并补齐用户提出的「已完成任务视觉弱化」与「预估工时」展示。
- 现状：阶段2 已完成默认自然月、手动刷新与最后刷新时间、打开 TAPD；本轮在此基础上加筛选条与字段。
- 关键实测依据：状态值是动态的（任务 open/progressing/done，缺陷 closed/in_progress 等），必须动态枚举；`effort` 字段任务/缺陷均存在，但可能为 null。
- 显式偏离（已确认）：① 阶段3 第9 项「未排期任务辅助展示」不做，单边日期任务也不进看板（缺日期任务只能靠 `due=null`/`begin=null` 单独拉取，成本与收益不匹配）；② 第6 项「任务详情展示」以 tooltip + 底部信息条形态交付，不新增独立详情面板。

## Implementation Changes

**筛选条（看板顶部常驻）**

- 时间范围：起止日期输入 + 快捷（本月／上一月／下一月），默认当前自然月；起晚于止时提示且不自动交换；最长 366 天（超出截断并提示），超过 92 天提示数据量较大。只有时间范围变化会重新拉取 TAPD。
- 项目多选：默认全选（即设置页已启用项目），取消勾选仅本地过滤。
- 成员多选：在阶段1「展示成员白名单」内多选，默认全选；白名单外成员的任务依然不进入看板。
- 状态多选：从已加载数据动态收集状态值，按「任务／缺陷」分组展示（值 + 条数），默认全选；不硬编码、不映射语义。
- 筛选后某成员无任务时自动隐藏其分组；筛选条件仅会话内保持，不写配置文件。

**完成态视觉与工时**

- 完成态判定：状态值 trim + 忽略大小写后命中 `{done, closed, resolved, rejected}` 即视为已完成；中文自定义状态按未完成处理。
- 已完成任务条降低不透明度、标签文字转深色以保证可读性；tooltip 标注「已完成」并始终显示原始状态值。属对 §3.5 的有意扩展（仅明度区分，不改色相）。
- 预估工时：拉取字段增加 `effort`；tooltip 与底部信息条各增加「预估工时」一行，原值显示不加单位，缺失时不显示。

**模块划分**

- 新增 `src/gantt/filters.ts`（纯函数）：`ScheduleFilters`、状态选项收集、项目/状态过滤、完成态判定。
- 新增 `src/components/board/FilterPanel.vue`（三个分组多选下拉 + 已选数徽标 + 全选/清空 + 时间范围输入与快捷）。
- 调整 tooltip、boardState（区分「无数据」与「筛选无结果」）、useSchedule（接入筛选与成员子集）、GanttBoard（完成态样式）、TAPD 字段映射与 `ScheduleTask`。

## Interfaces and Data Contracts

- `ScheduleFilters { range: DateRange; projectIds: string[] | null; memberKeys: string[] | null; statuses: string[] | null }`；`null` = 全选（不筛选），数组 = 显式选择，`[]` = 清空（无结果）。
- `StatusOption { sourceType: 'task' | 'bug'; value: string; count: number }`，由已加载数据收集（不随筛选收缩）。
- `ScheduleTask.effort?: string`（TAPD 原值字符串；缺失为 undefined）。
- 新增纯函数：`isCompletedStatus(status)`、`filterTasks(tasks, filters)`、`collectStatusOptions(tasks)`、`createDefaultFilters(range)`。
- `resolveBoardState` 输入增加可见/总任务数，区分「无数据」与「筛选无结果」。

## Test Plan

- 单元测试：状态选项收集（去重、计数、按来源分组、空集合）；项目/状态过滤与 `null` 语义；完成态判定（大小写、空格、中文状态、null）；筛选后成员分组隐藏与隐藏计数；tooltip 工时行（有值/无值）与完成态标注；`effort` 映射；boardState 新增分支。
- fixture 契约测试扩展：补齐 `done` 状态样本与 `effort` 值，保证「完成态变浅」与「工时行」可被视觉验收覆盖。
- 视觉验收（`pnpm dev` + `VITE_BOARD_FIXTURE=1` 截图）：筛选条渲染与多选交互、完成态任务条明显更浅、tooltip 含预估工时、筛选后空成员分组不出现。
- 端到端（`pnpm tauri:dev`）：切换项目/成员/状态筛选不产生新 TAPD 请求；修改时间范围产生一次新请求；状态选项来自真实数据。
- 命令验证：`pnpm test`、`pnpm build`。

## Assumptions

- 未排期任务区、单日标记、独立详情面板、以及 hover 联动高亮/点击空白取消选中/自动滚动到今日/键盘可达四项交互优化本轮均不做。
- 阶段3 第9 项不作实现，将在测试报告中记为偏离及原因。
- 时间范围上限 366 天、>92 天提示为默认取值，实现后如体感不佳可调。
- 筛选偏好不持久化，每次打开回到默认（本月 + 全部启用项目 + 全部白名单成员 + 全部状态）。
