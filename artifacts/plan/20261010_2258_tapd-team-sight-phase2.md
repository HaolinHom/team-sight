# TeamSight 阶段2 实施方案：正式看板主视图（/board）

## Summary

- 目标：按技术方案阶段2 交付团队成员排期主视图——成员分组、任务独立成行、日级网格、坐标计算、项目颜色、折叠展开、滚动对齐，以及任务条提示与详情入口。
- 现状：布局计算（`src/gantt/layout.ts`）与渲染层（`GanttBoard.vue`）在阶段0 已实现并有单测覆盖（77 个测试通过）。本轮工作是把它们从「PoC 验证页」升级为正式主视图，并补齐加载/空数据/错误状态与任务条交互入口。
- 已确认的边界：详情面板、筛选、交互体验优化（hover 行高亮、点击空白取消选中、虚拟滚动等）不在本轮，留到阶段3；本轮只做「入口与提示」。
- 有意变更：删除独立的 PoC 验证页与 `VITE_POC_AUTOLOAD` 钩子，视觉验收改由 `/board` 的 fixture 开关承担。

## Implementation Changes

**看板页面与路由**

- 新增 `src/pages/BoardPage.vue`（由现有 PocGantt 升级而来）作为产品主视图；`/` 重定向到 `/board`，删除 `/poc/gantt` 路由与 `src/poc/` 目录。
- 顶部工具栏：时间范围导航（上一月／本月／下一月＋当前范围文本）、刷新按钮、最后刷新时间、已启用项目数。
- 状态提示区（§3.1）：未配置凭据 → 引导去设置页；无启用项目 → 引导配置项目；无展示成员 → 提示任务会全部隐藏；加载中 → 加载态并禁用刷新（§4.4）；部分项目失败 → 保留成功项目数据并用 `describeTapdError` 给出可执行提示；无数据 → 空状态文案。
- 选中信息条：显示「项目｜标题｜负责人｜状态｜开始~截止」与独立的「打开 TAPD」链接（新标签打开），不展开详情面板。
- 数据加载时机：进入 `/board` 或时间范围变化时自动加载一次（仅桌面端、已配置凭据、至少一个启用项目）；刷新按钮手动重载。

**渲染层（GanttBoard / gantt 模块）**

- 新增 `src/gantt/tooltip.ts`：纯函数 `buildTooltipContent(task, { clippedStart, clippedEnd })` 生成提示内容（完整标题、项目、状态、负责人、日期区间、裁剪提示、日期异常提示），不臆造字段。
- GanttBoard 内实现自绘即时 tooltip（mouseenter/mousemove/mouseleave 驱动、跟随光标、边缘翻转），替换 SVG 原生 `<title>`；保留左侧标签列截断提示。
- 新增 `src/gantt/boardState.ts`：纯函数 `resolveBoardState(input)` 返回 `loading | fixture | no-credential | no-projects | no-members | empty | ready` 及文案，优先级为 loading > fixture > no-credential > no-projects > no-members > empty > ready。
- fixture 开关：`VITE_BOARD_FIXTURE=1` 时 `/board` 使用固定数据（由 `src/poc/mockData.ts` 迁至 fixture 模块并保留日期异常样本），不发 TAPD 请求、不要求凭据与配置。
- 既有能力保持不变：成员标题行不含任务条、每任务独占一行、同成员同日任务不遮挡、项目颜色稳定、折叠展开后重排、左右列纵向同步与表头吸顶、跨窗裁剪不改变原始日期。

**其他**

- App.vue 导航改为「看板 / 设置」；README 使用流程与验收说明同步更新。

## Interfaces and Data Contracts

- 路由：`/` → `/board`（默认）、`/board`、`/settings`；`/poc/gantt` 删除。
- 新增类型：`GanttTooltipContent` 与 `BoardState`（状态枚举 + 文案）。
- GanttBoard 对外 props/emits 不变，提示内容与定位为组件内部实现。
- fixture 数据契约：沿用 `ScheduleTask`，覆盖 §7.6 要求（≥2 成员、每人 ≥3 任务、多项目颜色、同成员日期重叠、跨多天、成员任务数不等、含可折叠成员）并保留缺失日期与日期倒挂样本。

## Test Plan

- 单元测试：tooltip 内容构造（裁剪、缺失日期、日期倒挂、无负责人）；`resolveBoardState` 优先级分支；fixture 满足 §7.6 清单；既有 77 个用例保持通过。
- 视觉验收（`pnpm dev` + `VITE_BOARD_FIXTURE=1`，浏览器截图核对 §10.3）。
- 端到端（`pnpm tauri:dev`，输出落盘）：自动加载真实数据，核对多成员/多项目/多任务、部分失败提示、选中信息条与「打开 TAPD」链接地址。
- 命令验证：`pnpm test`、`pnpm build`，确认无 `poc` 残留引用。

## Assumptions

- 折叠状态仅在会话内保持，不持久化。
- 未排期任务辅助区域按现状处理（无任务条 + 标签提示），阶段3 再引入独立区域。
- 自定义时间范围与筛选属阶段3；本轮仅支持按月导航。
- 交互体验优化留到阶段3；本轮仅交付任务条提示。
- 桌面端是唯一可拉取真实数据的运行环境，fixture 模式是浏览器侧唯一数据来源。
