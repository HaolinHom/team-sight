# TeamSight P1b 功能与使用说明核对报告

## Summary

2026-10-29，按技术方案 v1.2、分阶段执行方案、当前源码和已有验收报告，整理截至 P1b 的可用功能、操作步骤、对话模板及限制。新增用户说明，并在 README 更新当前状态及入口。本轮只修改文档，未实施 P1c。

采用源码/方案/文档静态对照、文档链接与工具名称检查，以及现有服务的只读状态检查。终端命令通过 iTerm 执行并以 `tee` 保存日志。文档检查使用 Node.js 22.23.4；首次状态检查的默认 Node 为 22.23.2，随后以已验收的 22.23.4 复核。

## Results

| 检查 | 结果 | 依据 |
| --- | --- | --- |
| 阶段范围 | PASS，清单覆盖 P0/P1a/P1b 已实现能力，发行、Windows、完整迁移、定时与退役仍列为后续 | 两份指定方案、P1b 主报告及原生宿主补充报告 |
| 正式工具名称与覆盖 | PASS，29 个正式服务端工具全部列入说明，无不存在的工具名称 | `server.ts`、`business-tools.ts`；`documentation-check.log` |
| 设置实际操作 | PASS，逐项核对表单标签、保存/重读、手动项目/成员添加、小时请假、日历和导入；未虚构“测试连接”按钮或自动添加项目 | `FormalSettings.vue`、配置 Schema 与存储实现 |
| 查询及写入用法 | PASS，区分 story/task/bug 读取和 story/task 写入；核对完整账号、允许范围、创建初始状态、摘要、幂等及 unknown 只读核对流程 | `contracts.ts`、`operations.ts`、`business.ts` |
| 分析及导出用法 | PASS，核对完整性、来源时间、当天进度、作业、缓存、视图分页与导出完整范围；区分 HTML 报告和 HTML 甘特 | `Analysis.vue`、`analysis.ts`、`business.ts`、`outputs.ts` |
| 本地链接 | PASS，说明与 README 的 10 个本地链接目标均存在；不包含外部网址可达性和 Markdown 锚点自动验证 | `documentation-check.log` |
| 格式检查 | PASS，README `git diff --check` 通过；新增说明无行尾空白且保留结束换行 | `documentation-check.log`，最终 `TASK_EXIT=0` |
| 现有 P1b 服务状态 | FAIL / 当前不可达，默认及指定 Node 下 CLI `status` 均未成功，带本地认证的 `/health` 读取为 `ECONNREFUSED` | 两份 `service-status*.log`、`service-diagnostic.json` |

服务状态检查只读取既有 `.local/teamsight-p1b-live/instance.json` 与本地访问令牌并请求健康状态；未输出令牌值。发现文件记录历史 P1b 实例与 `43129` 地址，不将其视为当前运行证明。已在使用说明给出恢复启动命令，保留数据目录；本次没有启动/停止服务、删除锁、修改配置或发送 TAPD 写入。

## Issues

- 原 P1b 验收服务 `http://127.0.0.1:43129/mcp` 当前未响应，需先启动才能通过 MCP 使用功能。此项是使用前提，不归因于文档改动，也不将历史验收结果改记为当前运行成功。
- 现有正式运行知识以 P0 为主，新增业务范围已有 P1a/P1b 知识候选。本次未验证超出既有候选的新业务事实，未重复生成候选或修改正式 knowledge；使用方式集中保存在用户说明。

## Not Tested

- 未重新执行构建、单元/组件测试或 TAPD 业务读写：本次只编辑文档，引用的 33 项包级测试、386 项旧 App 回归与真实创建/修改结果均来自已有 P1b 报告，不计为本轮重跑。
- 未重新验收 Codex 原生卡片。保留最近报告的证据边界：卡片可见已由用户确认，交互、宿主文件呈现及 P1b 设置新增表单保存往返仍待人工确认。
- 未执行 Windows、发行安装、完整迁移、宿主定时/无人值守及旧 App 退役，未进入 P1c。
- 未读取或核对当前完整团队配置，因此清单说明实现支持范围，不声称已有所有业务项目/成员/写入权限配置就绪。

## Artifacts

- [功能与使用说明](../../docs/TeamSight-P1b-功能与使用说明.md)、[README](../../README.md)。
- [技术方案](../plan/20261027_2341_teamsight-server-mcp-apps-technical-plan.md)、[分阶段执行方案](../plan/20261028_teamsight-v1.2-phased-implementation.md)。
- [P1b 主报告](./20261028_teamsight-p1b_测试报告.md)、[原生宿主补充报告](./20261029_teamsight-p1b-native-host_测试报告.md)。
- [文档检查日志](./20261029_teamsight-p1b-usage_evidence/documentation-check.log)。
- [首次服务状态日志](./20261029_teamsight-p1b-usage_evidence/service-status.log)、[指定 Node 复核日志](./20261029_teamsight-p1b-usage_evidence/service-status-locked-node.log)、[健康诊断](./20261029_teamsight-p1b-usage_evidence/service-diagnostic.json)。
- [最终文档检查日志](./20261029_teamsight-p1b-usage_evidence/final-check.log)。

主要实现对照入口：`apps/server/src/server.ts`、`business-tools.ts`、`business.ts`、`storage.ts`、`cli.ts`、`outputs.ts`；`apps/mcp-ui/src/FormalSettings.vue`、`Analysis.vue`；`packages/tapd/src/contracts.ts`、`operations.ts`、`hours.ts`；`packages/core/src/analysis.ts`、`settings.ts`。
