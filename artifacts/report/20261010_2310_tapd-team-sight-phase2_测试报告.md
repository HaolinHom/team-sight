# TeamSight 阶段2 测试报告

## Summary

- 测试对象：阶段2 交付物（正式看板主视图 `/board`、任务条即时提示、看板状态判定、fixture 视觉验收开关、路由与导航调整）。
- 测试方式：前端单元测试、类型检查与生产构建、浏览器 fixture 模式视觉验收（截图核对技术方案 §10.3 清单）、桌面端端到端真实数据验证、残留引用检查。
- 结论：全部通过；视觉验收 8 项逐条核对无错位；桌面端按 8 个已启用项目自动加载真实数据，无错误。

## Results

### 1. 单元测试（`pnpm test`）

- 结果：12 个测试文件、**94 个用例全部通过**（阶段1 为 77 个，本轮新增 17 个）。
- 新增覆盖：
  - `buildTooltipContent`：完整字段、裁剪提示不改日期、缺失日期三种形态、日期倒挂、无负责人/无状态/无标题占位。
  - `resolveBoardState`：ready 无提示、优先级（loading > fixture > 凭据 > 项目 > 成员 > 空数据）、各提示文案、浏览器环境补充说明。
  - fixture 契约：≥2 成员且任务数不等、前两名成员各 ≥3 任务、≥3 项目与 ≥3 颜色、同成员日期重叠、跨多天与跨自然月边界、保留缺失日期与日期倒挂样本、折叠成员有任务、任务键唯一。

### 2. 类型检查与生产构建（`pnpm build`）

- 结果：`vue-tsc --noEmit` 与 `vite build` 通过。产物：看板页 19.58 kB（gzip 7.47 kB）、设置页 8.03 kB、入口 94.14 kB。

### 3. 视觉验收（`pnpm dev` + `VITE_BOARD_FIXTURE=1`，浏览器实测截图）

对照技术方案 §10.3 逐项核对：

| 验收项 | 结果 |
| --- | --- |
| 每个任务独占一行 | 通过 |
| 成员标题行不显示任务条 | 通过（李四/王五/张三/未分配成员 四行均无任务条） |
| 同成员同日期多任务不遮挡 | 通过（同一成员的重叠任务各占一行） |
| 项目颜色稳定 | 通过（中台=蓝、商城=绿、数据平台=橙、客户端=紫） |
| 日期列与任务条准确对齐 | 通过（商品页适配起于 10-02 列，止于 10-12 列） |
| 左侧标题列与右侧任务条准确对齐 | 通过 |
| 折叠、展开后不存在行错位 | 通过（展开王五后新增 3 行，其后的张三分组整体下移且未错位） |
| 横向、纵向滚动后布局仍对齐 | 通过（横向滚动表头与网格同步；纵向滚动左列与任务条同步、表头吸顶、当日标记正确） |

补充核对：

- 任务条提示：点击/悬停任务条时自绘 tooltip 即时显示「标题 / 项目 / 负责人 / 状态 / 日期」，无原生 title 的延迟。
- 选中信息条：显示「[客户端] 修复结算问题 负责人：李四 状态：open 日期：2026-10-09 ~ 2026-10-14 打开 TAPD」，链接地址为 `https://www.tapd.cn/70000222/bug/view/9102`（任务/缺陷路径规则正确）。
- 年份与范围：表头显示「10月」与 1–31 日；当日（2026-10-10）红色虚线标记位于第 10 列。

### 4. 桌面端端到端验证（`pnpm tauri:dev`）

- 进入 `/board` 后自动加载真实数据，无需任何环境开关（`VITE_POC_AUTOLOAD` 已随 PoC 页面删除）。
- 依据配置（用户已在设置页启用 8 个项目、配置 6 名成员），Rust 诊断日志显示：8 次 `/workspaces/users`（每个已启用项目一次）+ 各项目 `/tasks`、`/bugs` 拉取；请求在加载完成后停止，无重复轮询。
- 桌面窗口加载成功（WebKit 网络进程与 Vite dev server 保持连接），运行日志无 error/panic。

### 5. 残留检查

- `src/` 下已无 `PocGantt`、`POC_*`、`/poc/gantt`、`VITE_POC_AUTOLOAD` 引用；`src/poc/` 目录已删除，固定数据迁至 `src/fixtures/ganttFixture.ts`。

## Issues

- **已修复（用户验收发现）**：桌面端点击底部信息条的「打开 TAPD」无任何反应。
  - 根因：该链接是普通 `<a target="_blank">`，而 Tauri 的 webview 不会处理新窗口/外部跳转；capabilities 当时只有 `core:default`，没有任何外部打开能力。
  - 修复：接入官方 `tauri-plugin-opener`，前端在桌面端改为 `preventDefault()` 后调用 `openUrl()`（浏览器模式保留原生新标签行为），并新增能力作用域把可打开范围限制在 `https://www.tapd.cn/*`；打开失败时在页面底部显示错误原因，避免再次静默失败。
  - 验证：新增 4 个单元测试（桌面端走插件、浏览器走新标签、拒绝非 https、插件报错向上抛出），总计 98 个用例通过；`pnpm build` 通过；`cargo build` 成功（插件编译通过）；构建期生成的 `src-tauri/gen/schemas/capabilities.json` 确认包含 `opener:allow-open-url` 与作用域配置，说明权限标识与作用域格式被 Tauri 接受。
  - 待人工确认：桌面窗口内的实际点击（开发二进制无 bundle id，自动化工具无法绑定窗口）。
- **已修复（用户验收发现）**：详情链接形态错误——生成为 `https://www.tapd.cn/<workspace_id>/<task|bug>/view/<id>`，正确应为 `https://www.tapd.cn/tapd_fe/<workspace_id>/<task|bug>/detail/<id>`。
  - 发现方式：用户在桌面端点开「打开 TAPD」后打开的是登录跳转页，并提供了正确的任务与缺陷链接样例。
  - 复核（HTTP 实测）：旧形态 `/<ws>/task/view/<id>` 返回 302 跳登录；新形态 `tapd_fe/<ws>/task/detail/<id>` 与 `tapd_fe/<ws>/bug/detail/<id>` 均返回 200。
  - 修复：`buildTapdUrl` 改为 `tapd_fe` 详情形态；固定验收数据的链接同步更新；测试夹具统一。
  - 验证：新增真实 ID 回归测试（`62120799/task/1162120799001210310`、`63253157/bug/1163253157001041841`），共 99 个用例通过；`pnpm build` 通过；桌面端已重启加载新代码。
- 说明：`pnpm dev` 浏览器模式下即使配置了令牌也无法拉取真实数据（TAPD 预检不支持 `Authorization` 头），页面通过状态区明确提示并引导使用 fixture 或桌面端，属预期行为。

## Not Tested

- 桌面窗口内的 GUI 点击（任务条悬停/点击、刷新、月份切换）仍无法自动化：开发二进制无 bundle id。已通过浏览器同源组件实测覆盖同一套交互逻辑，桌面端仅验证了数据加载链路。
- 大量任务下的滚动性能与虚拟滚动，属阶段4 范围。
- 筛选（时间范围自定义、项目/成员/状态）、完整任务详情面板、交互体验优化，按计划留到阶段3。

## Artifacts

- 方案：`artifacts/plan/20261010_2258_tapd-team-sight-phase2.md`
- 关键代码：`src/pages/BoardPage.vue`、`src/gantt/tooltip.ts`、`src/gantt/boardState.ts`、`src/components/gantt/GanttBoard.vue`、`src/fixtures/ganttFixture.ts`
- 命令日志：`/tmp/team-sight-logs/test-build-p2.log`、`/tmp/team-sight-logs/dev-fixture.log`、`/tmp/team-sight-logs/tauri-dev-p2b.log`
