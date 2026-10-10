# TAPD 跨项目团队排期看板 — 阶段0 实施方案

## Summary

- 目标：按技术方案第 11/13 节完成**阶段0 技术验证**——建立可运行的 Tauri 2 + Vue 3 桌面工程、验证甘特图成员分组布局可行性、核实 TAPD 真实接口能力，产出《技术验证报告》。本轮**不实现**完整看板业务页面。
- 本轮范围：task + bug 两类工作项（已确认，不含 story）；界面中文；包管理 pnpm；凭据开发期用 `.env.local`，Keychain 安全存储推迟到阶段1。
- 已核实事实（无需重复验证）：
  - 仓库为空工程；macOS 26.7、Node 22.23.2、pnpm 10.12.4、Xcode CLT 已装，**Rust/cargo 缺失**；`/Applications/iTerm.app` 存在且 iTerm2 正在运行，`osascript` 可用。
  - 凭据：`PERSONAL_TOKEN` 走 `Authorization: Bearer` 有效（`/quickstart/testauth` 返回 success）；走 Basic 返回 401。Base URL `https://api.tapd.cn`。
  - 项目：`WORKSPACE_IDS=63253157,62120799`；`/workspaces` 不支持枚举项目（422），项目 ID 必须配置。
  - 数据量：ws1 tasks 24,272 / bugs 9,599；ws2 tasks 2,904 —— 必须服务端按时间窗裁剪，不能全量拉取。
  - 字段差异：task 用 `name` + `owner`（格式 `姓名_工号;`，可多值）；bug 用 `title` + `current_owner`（`姓名_工号`，无尾分号，`owner` 恒为 null）。
  - 分页 `limit` 默认 30、最大 200；`/tasks/count`、`/bugs/count`、`/workspaces/users` 可用（ws1 返回 47 名成员，含 `user`/`name`）。
  - 时间查询：`begin=2026-10-01~2026-10-31` 形式有效；**开区间 `~2026-10-31`、`2026-10-01~` 被静默忽略并返回全量**，必须两端都给值。
  - Frappe Gantt 稳定版 1.2.2（MIT，约 3,000 行、单类 `Gantt`、行高由统一 `bar_height` 控制），**无成员分组能力**。
- 后续阶段（1–4：数据层与安全存储、甘特图核心布局、筛选交互、稳定性与打包）不在本轮，待本报告确认后另行推进。

## Implementation Plan

1. 工作包 0：终端约定落库（进入实施的第一步，先于工程初始化）
   - 在 `AGENTS.md` 末尾新增小节「`## 终端约定`」，内容锁定为三条：终端工具统一使用 iTerm（`/Applications/iTerm.app`）；需要实时观察或长时间运行的命令（dev server、构建、测试、验证脚本）必须在 iTerm 会话中执行并把输出 `tee` 到日志文件作为对照测试证据；短时只读命令复用已有 iTerm 会话，避免频繁新建窗口。
   - 命令投递方式：`osascript` 驱动 iTerm 现有窗口新建 tab 执行，命令与输出同时落盘到工作区内的临时日志文件（不入版本控制）。
   - 该改动以追加方式进行，不改动 `AGENTS.md` 既有 Startup/workflow 内容，也不触碰你当前未提交的其他改动。
2. 工程初始化（仓库根，正向骨架而非一次性 PoC 项目）
   - 安装 Rust 工具链（rustup + stable），验证 `cargo --version` 与 `cargo tauri --version`；若 macOS 26 仅 CLT 导致链接失败，记录为阻塞项并保留纯 Vite 兜底运行方式。
   - 建立 Tauri 2 + Vue 3 + TypeScript + Vite 骨架，补 `dev / build / test / tauri:dev` 脚本与 Vitest 配置。
   - 目录按技术方案第 6 节落地骨架：`src/gantt/`（布局与日期计算）、`src/services/tapd/`（请求与映射）、`src/types/`、`src/poc/`（PoC 页面，作为临时路由，阶段2 由正式看板替换）、`src-tauri/`。
3. TAPD 请求层与映射（只读）
   - `client.ts`：Bearer 认证、超时、网络错误/5xx 轻量重试（2 次退避）、`status!==1` 统一抛出可读错误；并发上限 3。
   - 队列策略：`GET /tasks`、`GET /bugs`，按项目 + 时间窗查询，`limit=200` 翻页至 `/count` 上限；时间窗用闭区间组合 `begin=<固定下限>~<rangeEnd>` 且 `due=<rangeStart>~<固定上限>`（此组合已实测命中跨月任务）。
   - `mapper.ts`：按上文字段差异映射为统一模型；`/workspaces/users` 建立「工号 → 姓名」索引，工号作为稳定成员 ID；映射失败字段保留 `rawStatus` 不臆造。
4. 甘特图 PoC（技术方案 7.6 节验收集）
   - 固定 mock 数据：2 个成员、每人 3+ 任务、任务颜色多项目、同成员日期重叠、跨多天任务、成员任务数不等、含 1 个折叠成员；禁用拖拽/改期交互。
   - 验证项：成员标题行、任务独立成行、日级网格、折叠展开后无行错位、左侧标题列与右侧任务条对齐、横纵向滚动对齐、表头吸顶。
   - 路线决策规则（预先锁定，避免主观摇摆）：先做 Frappe Gantt 适配层；若需要改动库源码 > 100 行，或需要 > 2 处 hack 式 DOM/CSS 补丁，则改为项目内自研 SVG 渲染层（复用已验证的日期→坐标数学）。结论写入报告。
5. 可复现的接口验证脚本
   - `scripts/verify-tapd.mjs`：读取 `.env.local`，只读执行认证、count、时间窗、分页、字段映射、成员映射、错误路径（无效 token / 不存在的 workspace），输出结构化能力矩阵，作为报告证据。Token 永不打印或落盘。
6. 交付物
   - 可运行的 Tauri 桌面 PoC（含 mock 甘特图 + 真实数据接口联通演示）。
   - 《技术验证报告》：可直接复用能力 / 必须自定义能力 / 需改动的第三方源码 / TAPD API 已验证情况 / 未解决问题 / 推荐最终实现路径 / 后续阶段任务清单。

## Interfaces and Data Contracts

- 统一任务模型沿用技术方案 `ScheduleTask`，仅补充来源类型字段 `sourceType: 'task' | 'bug'`（同 ID 空间下两类工作项可能重号，去重键为 `sourceType + id`）。
- 字段映射：task.id→id、task.name→title、task.owner→assignee、task.priority_label→priority、task.status→status；bug.id→id、bug.title→title、bug.current_owner→assignee、bug.status→status；两者 `begin→startDate`、`due→dueDate`。
- 日期一律 `YYYY-MM-DD` 字符串按自然日处理，禁止时区换算；`begin > due` 标异常不静默交换；负责人缺失归入「未分配成员」；双日期缺失归入未排期区。
- 请求层签名固定为 `fetchWorkspaceItems({ workspaceId, rangeStart, rangeEnd, type })`，返回 `ScheduleTask[]`，甘特图组件不得直接请求 TAPD。

## Test Plan

- 单元测试：日期差与坐标换算（`x(d)=diff×colWidth`、`width=(diff+1)×colWidth`）、跨边界裁剪、任务/缺陷字段映射、`姓名_工号` 解析与多负责人拆分、去重、缺失日期与异常日期分支。
- 组件/视觉验收：按技术方案 7.6 与 10.3 清单逐项人工核对 PoC 截图，重点为折叠前后与滚动后对齐。
- 命令验证（均走 iTerm，输出落盘）：`pnpm test`、`pnpm build`、`cargo tauri dev` 启动、`node scripts/verify-tapd.mjs` 真实接口矩阵。
- 对照测试完成后按 `rules/test.md` 生成测试报告，记录实际执行结果、未测项（Tauri 打包、Keychain、真实详情页 URL 打开）与风险。

## Assumptions

- 本轮不实现筛选、任务详情、Keychain、定时刷新、打包；PoC 路由与 mock 数据在阶段2 被替换。
- 详情页 URL 规则（`https://www.tapd.cn/<workspace_id>/task/view/<id>`、`.../bug/view/<id>`）本轮仅按已知形态实现并标注「待登录态人工核对」。
- `PERSONAL_TOKEN` 的有效期与权限范围未在文档中说明，本报告只记录「已实测可读 tasks/bugs/workspaces/users」，有效期问题列为待观察项。
- ws2 在当前月份时间窗内无缺陷、任务量仅 12 条，属正常数据分布，不作为接口异常处理。
- iTerm 约定在实施第一步写入 `AGENTS.md`；在此之前的探索性只读命令仍走内置通道。
- 不修改仓库既有 `docs/` 技术方案与用户未提交的工作区改动；不改动 Frappe Gantt 上游源码，任何必要改动只在项目内适配层进行。
