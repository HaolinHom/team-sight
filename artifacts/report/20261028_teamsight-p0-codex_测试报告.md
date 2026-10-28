# TeamSight P0 Codex 宿主补充验收报告

## Summary

日期：2026-10-28，时间统一按 Asia/Shanghai 解读；原始日志保留 UTC 时间戳。承接 [P0 macOS 总报告](20261028_teamsight-p0-macos_测试报告.md)，本轮仅补验 P0，没有实施 P1a，也没有修改产品源码或重新生成验证包。

**本轮约定的 P0 macOS 验收已完成，可提交用户确认。** 目标 Codex 会话内的 Apps 配置闭环、两卡片冲突、失败重试、服务重启恢复及中文图片输出已通过，凭据可见范围完成有限范围核查。用户核对当前 Codex MCP 设置页只有命令/URL 配置，未见 `.mcpb` 文件导入入口，按批准计划交付已实测的 JS 验证包及 HTTP 配置路径。Windows 实测继续按已批准安排延后，P1c 发布及旧 App 退役前补齐。此结论不代替用户的阶段通过确认。

使用原发行物 `teamsight-p0-darwin-arm64`，产品版本 `0.0.0-p0`；外部 Node 22.23.4、Node-API 10。原包内 `versions.json` 的 `codexAppsAcceptance: pending` 是构建时快照，本报告记录其后真实宿主验收结果，未篡改包内清单或原 ZIP。

## Results

| 验证项 | 实际结果 |
| --- | --- |
| 工具进入目标会话 | 重启 Codex 后，模型实际可调用 `teamsight_status`、`teamsight_probe_open_settings`、`teamsight_probe_render`；调用成功。app-only 的读取、保存、凭据核对与清理工具由真实 Apps 桥调用 |
| 首次打开与读取 | 第一张真实 Apps 卡片读到 r1：前端组、8 小时、Asia/Shanghai，测试凭据不存在。HTML 由 MCP 资源装载，没有独立网站 |
| 提交与新修订 | 表单修改团队名称、每日工时及业务时区，并提交测试哨兵；显示“已保存，修订 2”，服务返回 r2 和凭据存在状态 |
| 系统凭据 | 在真实卡片输入同一测试哨兵并核对，显示“测试凭据一致”；没有使用真实 TAPD 凭据 |
| 保存失败 | 勾选模拟失败，输入故障草稿并提交，显示 `SAVE_FAILED`，输入保留、修订仍为 2。重新调用打开工具返回之前成功值，故障草稿未落库 |
| 重开与重试 | 第二张独立 Apps 卡片读到 r2；第一张取消模拟失败后重试，成功得到 r3 |
| 两卡片修订冲突 | 第一张已提交 r3，第二张仍持 r2 提交旧草稿，真实提示当前修订 3 和重新读取要求，保留草稿；点击重新读取后恢复服务器 r3。验证对象是同一 Codex 对话中的两个独立 UI 实例，没有冒充两个独立 Codex 对话线程 |
| 正常退出 | 在 iTerm 执行已准备的脚本，旧实例正常停止，`instance.lock` 清理成功；没有删除锁或结束未知进程 |
| 新实例身份 | PID 从 38523 变为 44258；instanceId 从 `bd712988-97de-422d-bf5d-38b1b4247b2f` 变为 `4a0a63ea-031e-48b1-bdc3-e09600f05013`。重启 ready 时间为 12:01:09.924（UTC+8） |
| 现有卡片恢复 | 服务重启后在原第二张卡片点击重新读取，读到 r3、正确配置和凭据存在；随后模型状态工具也返回新实例，不需要重启 Codex |
| 跨进程凭据 | 在该卡片再次核对同一测试哨兵，显示一致，证明当前宿主流程中的配置与系统凭据跨进程保持 |
| 会话内图片 | 实际调用渲染工具返回 720×180 PNG，已查看，中文“团队排期 · 工时验证”显示完整；SHA-256 为 `39c1d905814ffe6d56b282b724d71a6491469c576c9e6e6655e28c0b142d09d9`。这是 P0 原生渲染样例，没有声称已实现业务甘特图 |
| 清理与还原 | 在真实 Apps 清理测试凭据，显示成功并得到 r4；恢复本轮开始时的“前端组 / 8 / Asia/Shanghai”，保存得到 r5。DOM 快照与再次实际打开工具均确认 r5、原配置和 `credentialPresent:false`，没有回退修订号 |
| 源码与暂存区 | 当前 24 个发行物来源文件与原 `versions.json` 的源码哈希全部一致；两个 ZIP 哈希保持原值。本轮只更新验收记录和知识候选，暂存区指纹未变；3 份更新文档的 46 个本地链接和空白检查通过 |

### 凭据可见范围

- UI 密码框的 DOM 快照显示 `<redacted>`。受支持的只读字段检查得到密码类型及遮蔽后的占位长度；没有尝试绕过遮蔽。
- 本次模型可见工具返回只有配置、修订、凭据存在或核对状态，没有返回测试哨兵明文。app-only 工具在本次模型工具列表中未暴露，**这不构成授权或保密保证**。
- 对重启前后服务日志、SQLite 主文件及 WAL/SHM 文件进行已知哨兵精确字节匹配，均未命中。没有读取 `.env.local` 或旧 App 凭据。
- 扫描本次重启后的桌面进程 40111 对应的四份本地日志，未命中哨兵。日志中存在保存工具名，未据此推断它记录了完整参数。未检查宿主内存、内部遥测、网络或其他私有存储。
- 本对话 rollout 中出现哨兵的地方是测试脚本填写输入及其后的摘要/上下文压缩。哨兵由测试 Agent 生成并已知，不能把这些命中当作 UI 向模型泄漏的证据，也不能据未命中其他位置声称宿主无法读取工具参数。
- Apps 提交必须经过宿主通信桥；正式凭据的提交边界和宿主信任仍需在后续正式设置方案中明确。本轮未输入真实秘密。

### 发布接入与 Bundle

普通 JS 验证包加 Streamable HTTP 配置已在目标 Codex 实际工作，保留原包、哈希与 Windows 交接文档。MCP 连接段仍为本机 `teamsight_p0_probe`；报告不回显 Bearer。

本轮查阅的 [官方 MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp) 说明命令及 HTTP URL 接入；[插件打包说明](https://developers.openai.com/plugins/build/plugins) 说明插件清单和 MCP 配置文件。插件目录机制不能直接证明 `.mcpb` 文件导入可用，也不能因为文档未提及便断言整个产品不支持。

原生设置受自动化安全限制，由用户实际查看后回复：“只有命令／URL 配置，未看到文件导入”。据此记录当前版本设置页未提供可见的 `.mcpb` 导入入口；没有执行文件安装，也不扩大为所有版本或所有插件入口都不支持。按 P0 计划的替代交付条件，保留已验证的 JS + HTTP 方式，没有将 ZIP 改名或生成未经宿主验收的 `.mcpb`。用户同时确认已在 iTerm 执行重启脚本并看到 ready，与落盘日志一致。

## Issues

1. **当前宿主的 Bundle 接入限制。** 用户实查 MCP 设置页未见 `.mcpb` 导入入口，本轮无法执行文件安装；按已验证的 JS + HTTP 方式交付，符合 P0 计划的替代路径。后续正式发布若改用插件或 Bundle，需要另行验证对应入口。
2. **保密结论有范围。** 已知测试哨兵在本次检查的服务/存储/宿主日志中未命中，不等于宿主不记录秘密；app-only 元信息不是隔离机制。
3. **自动化取证工具存在超时。** 凭据核对的等待包装器一次超时，但诊断和随后的 DOM 均显示“测试凭据一致”。最终 r5 截图步骤发生连接超时，未重复提交；r5 DOM 和实际工具重开已取证，保留 r4 清理成功截图。没有据此修改产品代码。
4. **定时触发时刻边界保留。** 上轮真实宿主任务已调用同一服务并清理；请求分钟与实际派发存在偏差，详见总报告，不能承诺精确到点。

## Not Tested

- `.mcpb` 安装动作未执行：当前版本 MCP 设置页经用户实查未见文件导入入口；当前 HTTP 接入已实测，不扩大到所有版本或其他插件入口。
- 两个不同 Codex 对话线程之间的 Apps UI 冲突。本轮用两张独立卡片验证用户可见冲突；前轮两个 SDK 客户端验证共享进程与修订语义。
- Windows 实机、其他架构、Linux、STDIO、自动开机启动、休眠或崩溃恢复，不扩展为通过。
- 宿主全部秘密存储、遥测或网络链路，以及真实 TAPD 凭据的保密承诺。
- TAPD 业务读写、真实排期/工时/风险/报表、配置导入及旧 App 退役，均未进入实施。
- 本轮没有重跑旧 App 构建或整套自动测试；产品源码与锁文件哈希未变，沿用总报告已记录的测试和构建证据。

## Artifacts

- [真实 UI 操作审计](20261028_teamsight-p0-codex_evidence/ui-audit.json)
- [保存成功](20261028_teamsight-p0-codex_evidence/02-saved.png)、[失败提示](20261028_teamsight-p0-codex_evidence/04-save-failed.png)、[旧卡片冲突](20261028_teamsight-p0-codex_evidence/07-conflict.png)
- [重启后读取](20261028_teamsight-p0-codex_evidence/10-restart-read.png)、[重启后凭据一致](20261028_teamsight-p0-codex_evidence/11-restart-keyring.png)
- [测试凭据清理回执](20261028_teamsight-p0-codex_evidence/12-credential-cleared.png)、[修订 5 DOM](20261028_teamsight-p0-codex_evidence/13-baseline-restored.txt)
- [最终打开返回](20261028_teamsight-p0-codex_evidence/final-open.json)、[最终状态](20261028_teamsight-p0-codex_evidence/final-status.json)、[会话内 PNG](20261028_teamsight-p0-codex_evidence/09-codex-render.png)
- [停止日志](20261028_teamsight-p0-codex_evidence/restart-stop.log)、[清锁日志](20261028_teamsight-p0-codex_evidence/restart-lock.log)、[新实例日志](20261028_teamsight-p0-codex_evidence/service-after-restart.log)
- [凭据范围核查](20261028_teamsight-p0-codex_evidence/credential-scope.json)、[接入与 Bundle 记录](20261028_teamsight-p0-codex_evidence/bundle-access.json)、[源码一致性](20261028_teamsight-p0-codex_evidence/source-consistency.json)
- [文档、压缩包及暂存区检查](20261028_teamsight-p0-codex_evidence/delivery-check.json)
- [Windows 验收交接](../../docs/validation/teamsight-p0-windows.md)、[正式运行知识](../../knowledge/teamsight-server-runtime-notes.md)

当前服务保留运行在 `127.0.0.1:43127`，隔离数据目录 `.local/teamsight-p0-host`。测试凭据已清理，临时宿主任务上轮已删除；MCP 配置保留以便后续验收。阶段完成仍需用户明确确认，当前不开始 P1a。
