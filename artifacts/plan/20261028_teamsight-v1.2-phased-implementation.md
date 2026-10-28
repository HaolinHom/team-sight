# TeamSight v1.2 分阶段实施计划

## Summary

按 P0 → P1a → P1b → P1c → 后续1 → 后续2 推进。每阶段完成实施、验证、成果与问题说明后停止，只有用户明确确认通过后才进入下一阶段。本轮仅实施 P0。

P0 先完成当前 macOS arm64 验收并交付 Windows 执行文档；Windows 实测待执行，须在 P1c 首版发布及旧 App 退役前补齐。

## Implementation Plan

1. 保留旧桌面入口，建立 apps/server、apps/mcp-ui 与 pnpm 工作区。以 Node.js 22.23.4、pnpm 10.12.4 验证；同一进程承载 MCP、应用服务、SQLite 与资源管理。主路径 Streamable HTTP，校验 loopback、访问身份、Host 与 Origin。
2. 固定 MCP core/server/client 2.4.0、Node 适配器 2.1.2、Apps SDK 2.0.4。提供 teamsight_status，其他原型工具使用 teamsight_probe_*。最小 Vue 设置表单构建为自包含 HTML，验证打开、读取、提交、新修订与重开闭环，必须在目标 Codex 会话实测。
3. 用 better-sqlite3 13.0.3 验证创建、短事务、修订冲突、重启恢复；@napi-rs/keyring 2.1.2 验证系统凭据；@resvg/resvg-js 2.6.2 验证 SVG、PNG 与中文。使用隔离目录和测试哨兵，不导入旧配置、不执行 TAPD 写入。
4. 交付 JS 代码、生产依赖、Apps 资源及目标平台原生模块，不携带 Node.js，不依赖安装时编译。独立目录验证资源与模块加载；实测 Bundle 接入口，不支持时提供 JS 验证包及 MCP 配置说明。
5. 临时宿主定时任务调用只读状态工具，至少留下一次真实调度记录后清理。服务不新增业务定时器。
6. 同步技术方案中的 P0 / P1c 验收门槛，交付版本清单、macOS 报告及 docs/validation/teamsight-p0-windows.md。

## Test Plan

- MCP 工具发现、调用、资源读取、多个连接共享同一服务进程。
- Apps 配置往返、两会话修订冲突、保存失败、重启持久化与凭据可见范围。
- SQLite、系统凭据、PNG 原生模块真实执行。
- 独立目录验证包、Node 缺失或版本不兼容诊断。
- 宿主真实定时调用、服务退出及重新启动，旧 App 构建。
- Windows 交接包含源码及产物版本、校验、PowerShell、Codex 配置、Apps 操作、自动入口、预期与证据模板、排错、只验收不扩展实现的接力提示词。

## Assumptions

- macOS 以当前 arm64 实测为准，其他架构逐项记录。Codex Apps 闭环若不能成立，停留 P0 交付可复查结果。
- P1a 核心/配置/基础查询，P1b 写入/分析/图表/报告，P1c 发布/迁移/定时/退役；后续1 Deepseek Harness，后续2 Linux、更多对象和插队协作。各阶段计划待前一阶段验收后收敛，当前不提前实现。
