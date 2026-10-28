# TeamSight v1.2 分阶段实施计划

## Summary

按 P0 → P1a → P1b → P1c → 后续1 → 后续2 推进。每阶段完成实施、验证、成果与问题说明后停止，只有用户明确确认通过后才进入下一阶段。P0 已确认通过；本轮实施 P1a，完成后停在 P1a 确认点。

P0 先完成当前 macOS arm64 验收并交付 Windows 执行文档；Windows 实测待执行，须在 P1c 首版发布及旧 App 退役前补齐。

## Implementation Plan

1. P0 已完成并通过确认：保留旧桌面入口，建立 apps/server、apps/mcp-ui 与 pnpm 工作区；以 Node.js 22.23.4、pnpm 10.12.4 验证；同一进程承载 MCP、应用服务、SQLite 与资源管理；主路径 Streamable HTTP，校验 loopback、访问身份、Host 与 Origin。
2. P1a 提取 `packages/core` 与 `packages/tapd`，统一日期、设置、排期映射、工时摘要和 TAPD 只读适配；通过注入传输验证分页参数、窗口查询参数、字段映射和重试边界。
3. P1a 将 SQLite schema 从 v1 迁移到 v2，增加正式 `settings` 与 `tapd_cache` 表；保留 P0 `config` 镜像兼容；验证配置导入、修订冲突、系统凭据引用、缓存和重启恢复。
4. P1a 提供正式 `teamsight_open_settings` Apps 资源，双入口构建为自包含 `index.html` 与 `settings.html`；设置页支持团队、时区、工时、项目、成员、TAPD 连接、旧 JSON 导入及基础只读查询。
5. P1a 仅提供 TAPD 项目列表、工作项搜索/读取和排期读取的只读工具；排期结果带 `complete/partial/failed`，完整结果才写缓存。TAPD 创建/修改、风险分析、图表、报表和宿主定时工作流仍留在后续阶段。
6. P1a 在 Node.js 22.23.4、pnpm 10.12.4 上完成构建、自动化验证和旧 App `pnpm build` 兼容性检查；阶段报告与候选知识待本阶段确认后归档。Windows、Bundle 实装及真实 TAPD 仍按原 P0/P1c 门槛执行。

## Test Plan

- MCP 工具发现、调用、资源读取、多个连接共享同一服务进程。
- Apps 配置往返、两会话修订冲突、保存失败、重启持久化与凭据可见范围。
- SQLite、系统凭据、PNG 原生模块真实执行。
- 独立目录验证包、Node 缺失或版本不兼容诊断。
- 宿主真实定时调用、服务退出及重新启动，旧 App 构建。
- Windows 交接包含源码及产物版本、校验、PowerShell、Codex 配置、Apps 操作、自动入口、预期与证据模板、排错、只验收不扩展实现的接力提示词。

## Assumptions

- macOS 以当前 arm64 实测为准，其他架构逐项记录。Codex Apps 闭环若不能成立，停留 P0 交付可复查结果。
- P1a 已完成实现与自动验证，等待用户确认；P1b 写入/分析/图表/报告，P1c 发布/迁移/定时/退役；后续1 Deepseek Harness，后续2 Linux、更多对象和插队协作。各阶段计划待前一阶段验收后收敛，当前不提前实现。
