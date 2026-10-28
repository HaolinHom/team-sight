# TeamSight P1a 测试报告

## Summary

本报告覆盖 P1a：核心模块提取、服务传输与统一 SQLite 存储、旧配置导入、正式 MCP Apps 设置资源、TAPD 基础只读查询和排期结果缓存。P0 已由用户确认通过；本报告只记录 P1a 当前工作树的实现与自动验证，P1b 未开始。

验证基线为 macOS arm64、Node.js 22.23.4、pnpm 10.12.4。测试使用隔离临时目录、内存凭据哨兵和注入的 TAPD mock transport，没有读取真实 TAPD 凭据，没有执行 TAPD 写入。

## Results

### 构建与兼容性

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm install` | 通过，workspace lockfile 已同步 | `/tmp/teamsight-p0/p1a-build.log` |
| `pnpm p1a:build` | 通过 | `/tmp/teamsight-p0/p1a-build.log`，core/tapd/server/mcp-ui 均完成 TypeScript/Vue 构建 |
| MCP Apps 资源 | 通过 | `apps/mcp-ui/dist/index.html` 与 `apps/mcp-ui/dist/settings.html` 均生成自包含 HTML；构建未产生外部 script 引用 |
| MCP Apps 空白修复后重建 | 通过 | `/tmp/teamsight-p0/p1a-ui-build.log`；两个入口拆为独立构建，产物仅保留两个 HTML，未发现外部 script、`modulepreload` 或相对 import |
| Codex Apps 实际设置闭环 | 通过 | 最新版本化 P1a 卡片显示“P1a · 正式设置”；修订 7→8 保存、重新读取保持修订 8；旧修订提交收到当前修订 9 的冲突提示，重新读取恢复“前端组 / 修订 9” |
| 旧 App 构建 | 通过 | `pnpm build`，`/tmp/teamsight-p0/p1a-compat.log` |
| `git diff --check` | 通过 | `/tmp/teamsight-p0/p1a-check.log` |

Vite 对 zod 依赖中的两个 `@__PURE__` 注释给出可忽略的 Rollup 警告，构建结果正常；该依赖源码未被修改。

### 自动化测试

`pnpm p1a:test` 全部通过：

- `packages/core`：4 个测试，覆盖自然日期、旧配置字段与凭据忽略、TAPD 字段映射、请假扣减和每日工时摘要。
- `packages/tapd`：2 个测试，覆盖 task/bug 字段差异、分页/日期窗口参数、任务与缺陷关键词参数、5xx 重试和 403 单次失败。
- `apps/server`：6 个测试，覆盖运行时门槛、SQLite CAS/锁等待/事务回滚、P1a 设置迁移与重启恢复、凭据引用、缓存持久化、双 MCP 会话、正式设置资源、修订冲突、无凭据诊断、mock TAPD 查询和 `complete/partial/failed` 排期状态。

测试日志：`/tmp/teamsight-p0/p1a-test.log`。

### P1a 实现结果

- `packages/core` 提供日期、设置归一化/旧配置导入、排期映射、任务去重和每日工时摘要；不依赖 Vue、Tauri 或 MCP。
- `packages/tapd` 提供注入式传输、Bearer 请求、task/bug 映射、字符串 ID、项目列表、单项读取、关键词/状态/分页/日期窗口参数以及有限重试。
- SQLite schema 从 P0 v1 迁移为 v2，新增 `settings` 和 `tapd_cache`；P0 `config` 表保留为兼容镜像。正式设置以修订号做乐观并发控制，凭据只保存系统凭据账户引用。
- 正式 `teamsight_open_settings` 关联版本化资源 `ui://teamsight/settings-p1a.html`。设置页支持团队名称、时区、每日目标工时、项目、成员、TAPD Base URL/workspace/token、旧 JSON 导入和基础只读查询；Token 读取只显示存在状态。
- `tapd_list_projects`、`tapd_search_items`、`tapd_get_item` 和 `teamsight_get_schedule` 已注册。排期查询按配置项目和日期窗口获取，结果带 `complete/partial/failed`；只有完整结果写入 SQLite 缓存。
- 服务保持单 Node.js 进程；`startServer` 仅为自动化测试增加了可注入的 vault/transport，生产启动仍使用系统凭据和实际 TAPD transport。

### 当前 Codex 会话验证

服务切换到 P1a 后，当前 MCP 端点的协议级检查已通过（日志：`/tmp/teamsight-p0/p1a-conversation-check.log`）：

- 发现 `teamsight_open_settings`、`teamsight_read_settings`、`teamsight_save_settings`、`teamsight_import_settings`、`tapd_list_projects`、`tapd_search_items`、`tapd_get_item` 和 `teamsight_get_schedule`。
- 读取 `ui://teamsight/settings-p1a.html` 成功，MIME 为 `text/html;profile=mcp-app`，没有外部 script 引用。
- 设置读取最终恢复为修订 9、团队“前端组”、凭据未配置；无凭据的 TAPD 项目查询返回 `CONFIG_REQUIRED`。
- Codex reconnect 后当前对话已经发现正式 P1a 工具；MCP 设置页显示的 `teamsight_p0_probe` 是现有连接别名，服务端同一端点已返回 P1a 工具目录。
- 实际会话调用 `teamsight_status` 最终返回 P1a、PID `83033`、instanceId `a8410aa4-d3c1-4d43-bf73-d676fdf91a2d`、revision `9`；调用 `teamsight_open_settings` 返回正式设置快照。
- 实际会话调用 `tapd_list_projects`、`tapd_search_items`、`tapd_get_item` 在无凭据条件下均返回 `CONFIG_REQUIRED`；同一日期窗口的 `teamsight_get_schedule` 首次返回 `complete`，再次调用命中 SQLite 缓存并返回 `cacheHit=true`。

## Issues

没有发现阻断 P1a 服务协议和只读查询验证的问题。

当前排期查询每个项目/类型读取单页（上限 200 条）；达到上限时返回 `partial`，完整分页收敛与更复杂复合分析留在后续阶段处理。正式 Apps 资源、宿主通信桥和最新版本化卡片的真实读写/冲突交互均已验证。

本轮修复了两个宿主兼容问题：多入口 `vite-plugin-singlefile` 产物残留共享 Vue helper，现由 `apps/mcp-ui/build.mjs` 对 P0/P1a 分别执行单入口构建；设置页提交前将 Vue 响应式 Proxy 复制为普通 JSON 对象，并将资源 URI 版本化为 `ui://teamsight/settings-p1a.html` 以避免旧卡片缓存。

## Not Tested

- 未调用真实 TAPD API，未验证真实账号权限、项目元数据和服务端数据量。
- 未实现或测试 TAPD 需求/任务创建、修改、风险分析、甘特图、工时报表、PNG/HTML 业务产物和宿主定时任务。
- 未进行 Windows 实机、Linux、Deepseek Harness、Bundle 直装或发布迁移验收；这些按技术方案的 P1c/后续阶段门槛执行。
- 未替换旧 App 的 Tauri 数据入口；旧 App 仅完成根目录构建兼容检查。

## Artifacts

- [技术方案 v1.2](../plan/20261027_2341_teamsight-server-mcp-apps-technical-plan.md)
- [分阶段实施计划](../plan/20261028_teamsight-v1.2-phased-implementation.md)
- P1a 构建日志（本机临时证据）：`/tmp/teamsight-p0/p1a-build.log`
- P1a 测试日志（本机临时证据）：`/tmp/teamsight-p0/p1a-test.log`
- P1a 修复后构建与回归日志：`/tmp/teamsight-p0/p1a-final-after-ui-fix.log`、`/tmp/teamsight-p0/p1a-regression-after-ui-fix.log`
- P1a Apps 资源协议复核：`/tmp/teamsight-p0/p1a-conversation-check-after-fix.log`
- 关键实现：`packages/core/`、`packages/tapd/`、`apps/server/src/storage.ts`、`apps/server/src/server.ts`、`apps/mcp-ui/src/FormalSettings.vue`。

本阶段成果停在 P1a，等待用户确认后才进入 P1b。
