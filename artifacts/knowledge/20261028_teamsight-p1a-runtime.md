# TeamSight P1a 运行候选知识

> 候选状态：待用户确认，不直接提升正式 knowledge。验证基线：macOS arm64、Node.js 22.23.4、pnpm 10.12.4。

## 已验证事实

- P1a 的工作区包为 `packages/core` 与 `packages/tapd`；根脚本 `pnpm p1a:build` 会依次构建 core、tapd、server 和 mcp-ui，`pnpm p1a:test` 会执行三组 Node test。
- `apps/mcp-ui` 使用 Vite 与 `vite-plugin-singlefile`，通过 `build.mjs` 对 P0/P1a 分别执行单入口构建，产出 `dist/index.html`（P0 原型）与 `dist/settings.html`（P1a 正式设置页）；多入口共用 Vue helper 会留下外部 import，导致 MCP Apps 空白，必须保持单入口构建并检查无外部 script、`modulepreload` 或相对 import。
- `apps/server` 仍是单 Node.js 进程。P1a 正式设置资源为版本化 URI `ui://teamsight/settings-p1a.html`，工具为 `teamsight_open_settings`、`teamsight_read_settings`、`teamsight_save_settings`、`teamsight_import_settings`；P0 `teamsight_probe_*` 入口保留兼容。
- MCP Apps 的 `callServerTool` 参数不能直接携带 Vue 响应式 Proxy；设置页提交前需要将项目、成员、工时和 TAPD 嵌套值复制为普通 JSON 对象，否则读取可用但保存会在桥接层失败且服务端无请求日志。
- SQLite schema v2 新增 `settings` 与 `tapd_cache`，P0 `config` 表作为镜像保留。设置使用修订号做乐观并发控制，Token 只保存系统凭据账户引用；完整排期结果才写入缓存。
- TAPD 基础只读查询使用注入式 transport 便于隔离测试；task 使用 `name`、bug 使用 `title`，分页使用 `page`，日期窗口使用闭区间相交查询参数。5xx 最多重试三次，4xx 不重试。

## 边界

- 本候选只覆盖 P1a 自动化验证；未证明真实 TAPD 权限、Windows/Linux、Deepseek Harness、Bundle 安装或真实 Codex 正式设置卡片的视觉回归。
- `teamsight_get_schedule` 每项目/类型先读取一页，上限 200 条时返回 `partial`；完整分页和复合分析仍待后续阶段。

## 依据

- `artifacts/report/20261028_teamsight-p1a_测试报告.md`
- `/tmp/teamsight-p0/p1a-build.log`
- `/tmp/teamsight-p0/p1a-test.log`
