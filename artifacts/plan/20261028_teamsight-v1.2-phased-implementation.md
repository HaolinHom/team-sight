# TeamSight v1.2 分阶段实施计划

## Summary

按 P0 → P1a → P1b → P1c → 后续1 → 后续2 推进。每阶段完成实施、验证、成果与问题说明后停止，只有用户明确确认通过后才进入下一阶段。P0、P1a 已确认通过；本轮已实施 P1b，停在 P1b 验收点，未进入 P1c。Codex 原生分析卡片仍待人工验收。

P0 先完成当前 macOS arm64 验收并交付 Windows 执行文档；Windows 实测待执行，须在 P1c 首版发布及旧 App 退役前补齐。

## Implementation Plan

1. P0 已完成并通过确认：保留旧桌面入口，建立 apps/server、apps/mcp-ui 与 pnpm 工作区；以 Node.js 22.23.4、pnpm 10.12.4 验证；同一进程承载 MCP、应用服务、SQLite 与资源管理；主路径 Streamable HTTP，校验 loopback、访问身份、Host 与 Origin。
2. P1a 提取 `packages/core` 与 `packages/tapd`，统一日期、设置、排期映射、工时摘要和 TAPD 只读适配；通过注入传输验证分页参数、窗口查询参数、字段映射和重试边界。
3. P1a 将 SQLite schema 从 v1 迁移到 v2，增加正式 `settings` 与 `tapd_cache` 表；保留 P0 `config` 镜像兼容；验证配置导入、修订冲突、系统凭据引用、缓存和重启恢复。
4. P1a 提供正式 `teamsight_open_settings` Apps 资源，双入口构建为自包含 `index.html` 与 `settings.html`；设置页支持团队、时区、工时、项目、成员、TAPD 连接、旧 JSON 导入及基础只读查询。
5. P1a 仅提供 TAPD 项目列表、工作项搜索/读取和排期读取的只读工具；排期结果带 `complete/partial/failed`，完整结果才写缓存。TAPD 创建/修改、风险分析、图表、报表和宿主定时工作流仍留在后续阶段。
6. P1a 在 Node.js 22.23.4、pnpm 10.12.4 上完成构建、自动化验证和旧 App `pnpm build` 兼容性检查，并已由用户确认通过。Windows 与 Bundle 实装仍按原 P0/P1c 门槛执行。
7. P1b 将工时、小时请假、中国日历和甘特布局迁入共享核心，旧 App 使用相同实现；迁移 SQLite 到 v3，保存不可变快照/分析/文件、作业状态及持久操作回执。
8. P1b 完成需求与任务 POST 表单创建/修改、项目元数据、固定操作目录及统一参数契约；写前检查项目/操作/字段范围、精确成员身份、状态和修改摘要。稳定幂等键防止本服务重复发送，未知结果先只读核对。
9. P1b 完成复合排期/工时分析、可解释风险、分析 Apps、中文 SVG/PNG 分页及 Markdown/HTML/CSV/JSON 固定报告。图、表、风险和报告复用同一 `analysisId`；保留部分/失败数据、未知量、来源时间与范围限制。
10. P1b 在指定项目 `62119705` 创建并修改各一个测试需求和任务，读回核验通过；33 项核心/适配/服务测试、旧 App 386 项回归和构建通过。SDK 浏览器验证了分析视图与产物，真实 Codex 原生卡片因工具安全策略未执行。结果见 [P1b 测试报告](../report/20261028_teamsight-p1b_测试报告.md)。

## Test Plan

- MCP 工具发现、调用、资源读取、多个连接共享同一服务进程。
- Apps 配置往返、两会话修订冲突、保存失败、重启持久化与凭据可见范围。
- SQLite、系统凭据、PNG 原生模块真实执行。
- 独立目录验证包、Node 缺失或版本不兼容诊断。
- 宿主真实定时调用、服务退出及重新启动，旧 App 构建。
- Windows 交接包含源码及产物版本、校验、PowerShell、Codex 配置、Apps 操作、自动入口、预期与证据模板、排错、只验收不扩展实现的接力提示词。
- P1b 覆盖分页/count 不一致、队列并发与重试边界、幂等重放与冲突、超时未知和重启恢复、修改冲突、缓存失效与旧分析不可变、取消、转义及中文分图；指定项目真实需求/任务创建修改不能由 mock 代替。
- P1b 的 Codex 原生分析 Apps、宿主导出呈现仍需人工完成；SDK 浏览器检查不计为该项通过。P1c 才实施发行、Windows 实机、定时调用及旧 App 退役。

## Assumptions

- macOS 以当前 arm64 实测为准，其他架构逐项记录。Codex Apps 闭环若不能成立，停留 P0 交付可复查结果。
- P1a 已由用户确认通过；P1b 已完成实现与可执行验证，等待阶段验收确认。P1c 发布/迁移/定时/退役；后续1 Deepseek Harness，后续2 Linux、更多对象和插队协作。各阶段计划待前一阶段验收后收敛，当前不提前实现。
