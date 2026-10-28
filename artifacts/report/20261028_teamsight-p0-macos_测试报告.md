# TeamSight v1.2 P0 macOS 验收报告

## Summary

日期：2026-10-28。仅实施 P0，未进入 P1a。单进程服务、MCP Apps Vue 原型、隔离配置/凭据、原生模块验证、两平台 JS 验证包和 Windows 交接文档已交付。

**结论：本轮约定的 P0 macOS 验收已完成，提交用户确认，未进入 P1a。** 自动验证、原生运行和目标 Codex Apps 功能通过；Codex 重启后已补齐真实配置往返、两卡片冲突、保存失败/重试、服务重启恢复与会话内图片，凭据完成有限范围核查。用户实查当前 MCP 设置页未见 `.mcpb` 文件导入入口，按批准计划采用已实测的 JS 验证包 + HTTP 配置替代路径，详见 [宿主补充报告](20261028_teamsight-p0-codex_测试报告.md)。Windows 按已批准安排标记待执行，P1c 发布及旧 App 退役前必须补齐。

环境：macOS 26.7（25G229），arm64；外部 Node.js 22.23.4、Node-API 10、pnpm 10.12.4。桌面宿主位于 `/Applications/ChatGPT.app`，Bundle ID 对应 `com.openai.codex`，版本 26.1016.62342 / build 21477；Codex CLI 0.156.0。机器命令显示的本地时间为 UTC+8；调度证据同时保留 UTC，业务原型时区显式为 Asia/Shanghai / UTC。

源码基线 HEAD `6c8e1aa3ec66f6dc64e0b34c97f6f3e7849d22be`，本次修改尚未创建提交。精确实现以发行物 `versions.json` 中的源码 SHA-256 为准，不能只靠该 HEAD 识别本次新增代码。既有暂存文档保留，未修改旧 App 的业务源码、未读取 `.env.local`、未导入真实配置或执行 TAPD 操作。

## Results

| 对象 | 结果与证据 |
| --- | --- |
| P0 构建 | Vue 类型检查、自包含 HTML 与服务 TypeScript 构建通过。HTML 306,058 字节，运行不依赖 CDN；没有外链 script |
| 自动契约测试 | 4/4 通过：Node/Node-API 门槛；SQLite 修订、真实只读失败、回滚/恢复；写锁等待；HTTP 多客户端、身份、Host/Origin、资源、端口冲突及重启 |
| 单进程及 MCP | 两个 SDK 客户端共享同一 PID/instanceId、SQLite 和资源；工具发现、调用、resources/list/read 通过。单个连接结束后服务仍可使用 |
| 配置修订 | r0 → r1；旧修订提交返回 REVISION_CONFLICT；模拟事务失败返回 SAVE_FAILED，输入对应数据库值没有提交。query_only 模式的真实写入错误返回 STORAGE_WRITE_FAILED |
| SQLite | better-sqlite3 13.0.3 实际创建、WAL、短事务、读写与关闭后恢复通过；原生 SQLite 版本 3.53.4 |
| 同步锁等待 | 第二连接持有写锁时，失败等待实测约 1,058 ms，busy_timeout=1,000 ms；失败后修订不变。此同步等待阻塞 Node 事件循环，不能解释为无阻塞异步数据库 |
| 系统凭据 | keyring 2.1.2 在真实系统凭据库写入随机哨兵、核对、进程重启后核对、删除通过。测试使用独立条目，不接触旧 App 凭据 |
| 脱敏边界 | 已在真实 Apps 提交测试哨兵，核对及清理通过；UI 密码框快照遮蔽，模型工具结果、SQLite、服务输出及本次宿主进程日志未发现哨兵明文。测试脚本及其摘要中已知哨兵可见；没有据此承诺宿主完全不记录秘密 |
| SVG / PNG | resvg 2.6.2 真实加载与渲染通过，720×180 PNG 为 7,281 字节；已直接查看 PNG，中文“团队排期 · 工时验证”显示正常 |
| 最终包独立运行 | 最终 macOS 包复制到 `/tmp/TeamSight P0 final package`，直接用外部 Node 运行 verify.mjs；无需 pnpm install、原生下载或编译。两个真实子进程先后启动，配置及系统凭据跨进程恢复通过 |
| 生命周期 | 正常退出清理 instance.json / instance.lock，数据库与 MCP 身份保留；重启创建新 instanceId。端口占用拒绝启动且不终止原实例；同目录第二实例被锁拒绝 |
| Node 诊断 | 在隔离 PATH 下实测 NODE_MISSING，退出码 1；用已安装 Node 20.19.5 运行入口实测 NODE_UNSUPPORTED，退出码 1，原生模块加载前即拒绝 |
| Codex 配置识别 | teamsight_p0_probe 被 CLI 识别为 Streamable HTTP；重启桌面宿主后，目标会话实际发现并成功调用状态、打开设置和图片工具 |
| Codex Apps 闭环 | 两张真实卡片完成 r1→r2 保存、失败回滚、重开、重试到 r3、旧 r2 提交冲突及重新读取。这里是同一对话的两个 UI 实例，未冒充两个不同 Codex 对话线程 |
| 宿主重启恢复 | iTerm 正常停止并重启服务，原卡片读回 r3，系统测试凭据仍核对一致；清理后恢复本轮开始的隔离配置，最终为 r5、凭据不存在。截图、DOM、真实工具结果已归档 |
| 宿主自动运行 | 宿主创建的独立自动化线程真实调用 teamsight_status，返回同一服务 PID/instanceId，退出码 0；任务已删除、验收线程已归档。精确触发时刻存在限制，见下文 |
| 旧 App | `pnpm build` 与 `pnpm tauri build --bundles app` 通过，保留 Vue/Tauri 入口；TeamSight.app 12.89 MiB。未执行旧 App 全功能交互回归 |
| 产物校验 | 两平台各 2,042 个文件的 SHA-256 与当前源码哈希核对通过；无符号链接，生产依赖 25 个，均只有对应目标的三个 .node 模块，无 Node.js 运行时 |
| 交付检查 | 上轮 git diff --check 通过，6 份交付文档中的 34 个本地链接可解析，原 Codex 配置内容完整保留。本轮对更新文档另行进行文件级空白/链接及源码一致性检查，保留实例使用 Node 22.23.4 |

最后一次独立包自动验收：首次实例 `ed3f03ef-c4ef-4f6b-b29f-f49270ff90fd`，重启实例 `06fd7dec-9d4c-4c81-b497-4a18c6658574`，共享服务 PID 36972。`acceptance.json` 中 Apps / scheduler 的 NOT_TESTED_BY_THIS_SCRIPT 是刻意保留的边界，宿主自动化证据另外记录。

### 发行物

| 目标 | 压缩包字节 | SHA-256 | 状态 |
| --- | --- | --- | --- |
| darwin-arm64 | 12,708,536 | ef76836907450e91f9df800df3ec0a5c19da73bf26d787f354b231672ac8323f | macOS 独立目录实际执行通过 |
| win32-x64 | 13,503,529 | e04333459af872c628b64c95f0ca312ac102922332572de467f3d8914494d517 | 打包和结构/PE 文件/哈希检查通过；Windows 执行待验 |

解压目录磁盘占用分别约 51 MiB / 53 MiB，包含整个 P0 生产依赖图，不能把总包体积全部归因于 SQLite。Windows keyring / resvg 原生包在打包阶段从 npm 获取并校验 integrity；SQLite 使用其 npm 包自带的目标预构建模块。没有把 macOS 依赖安装结果直接当作 Windows 可用证据。

### 真实宿主自动化

- 自动化 ID：`teamsight-p0`；独立执行线程：`01a18093-6219-77b1-8cca-6c284fe01ed8`。
- 实际 MCP 调用时间：`2026-10-28T03:35:32.309Z`；工具 `teamsight_status`；PID 32679；instanceId `3d2227c5-9c41-4523-9905-cc2573b60a76`，与手动启动的同一服务一致。
- 未手动执行该自动化代替调度。自动化线程用只读客户端脚本连接既有服务，没有启动第二个 TeamSight 服务，也没有新增 TeamSight 业务计时器。
- 宿主请求配置为每小时第 36 分钟，实际线程提前派发、调用发生于第 35 分钟。本轮证明了真实自动化环境可以访问同一服务，**未证明该宿主版本精确到点执行**。触发时间语义在 P1c 定时工作流验收时复查，不能据此承诺精确通知时间。
- 自动化线程初次将命令输入到运行服务的终端，未由 shell 执行，随后在新标签页完成一次调用。原始成功日志已单独归档；正常退出旧实例前清理了该专用终端的残留输入。
- 临时任务删除成功，线程归档成功；未保留周期任务继续运行。

## Issues

1. **宿主 Apps 原阻塞已解除。** 用户重启 Codex 并展开两张卡片后，实际工具及 MCP Apps 专用 DOM 自动化可用，功能闭环通过；原生 Codex/iTerm UI 仍受自动化安全限制。重启服务通过用户在 iTerm 执行脚本完成。最终截图取证有工具超时，r5 DOM 和实际工具重开均已确认，详见补充报告。
2. **凭据核查存在明确边界。** 已补查真实 UI、模型工具结果、本对话记录和当前宿主进程日志；没有检查宿主内部遥测、内存或网络，不能声称宿主无法读取桥接参数。app-only 元信息不是保密或授权保证，P0 只允许测试哨兵。
3. **Bundle 接入限制已记录。** 用户实查当前 Codex MCP 设置页仅有命令/URL 配置，未见 `.mcpb` 文件导入入口，因此未执行文件安装；不扩大为整个产品的所有入口或版本都不支持。按 P0 批准计划采用普通 JS 验证包和已在目标宿主实测成功的 HTTP 配置路径，未生成冒充可安装 Bundle 的 ZIP。
4. **宿主调度精确时刻存在偏差。** 如上，仅最小可达性成立，不能把创建成功或独立执行成功当作精确时刻保证。
5. Vite 对锁定 zod 包内的两条 PURE 注释输出 Rollup 警告，构建正常完成；未修改第三方源码来消除提示。

早期验证发现并修正了服务声明文件生成错误、HTTP Host 测试中 fetch 不按预期发出自定义 Host，以及新 Node 版本下 pnpm shim/PATH 切换问题。最终验收显式选择 Node 22.23.4。Node 22.23.2 的早期成功记录没有被冒充为最终版本证据。

## Not Tested

- 当前版本 MCP 设置页经用户实查未见 `.mcpb` 导入入口，未执行文件安装；两个不同 Codex 对话线程的 Apps 冲突没有单独实测。本轮两卡片与前轮 SDK 两连接证据分别记录，不扩大结论。完整秘密链路的不可访问部分仍保留边界。
- Windows 实际模块加载、凭据管理器、字体、Apps、调度、退出与重启；详见交接文档。macOS x64、Windows arm64、Linux 不在本轮实测范围。
- STDIO、自动开机启动、升级/崩溃恢复、Keyring/数据库跨存储崩溃补偿、应用休眠/离线及精确调度语义；正常退出与重启已测，不扩大为这些场景通过。
- TAPD 读取/写入、业务核心提取、旧配置导入、真实排期/工时/风险/报告，全部留在后续阶段。旧 App 全功能交互没有重跑。

## 保留状态与下一步

最终 macOS 包的服务保留运行：`http://127.0.0.1:43127/mcp`，数据目录 `.local/teamsight-p0-host`，Node 22.23.4。本轮重启后 PID 44258、instanceId `4a0a63ea-031e-48b1-bdc3-e09600f05013`（后续重启会改变）。测试凭据已清理，没有 TAPD 凭据；配置恢复为本轮开始时的“前端组 / 8 小时 / Asia/Shanghai”，修订自然递增到 5，没有恢复为原型默认值或回退修订号。

`~/.codex/config.toml` 中仅新增测试段 `mcp_servers.teamsight_p0_probe`，其余既有配置保留；本机测试 Bearer 仅存在本地权限受控文件，报告不回显。原配置备份位于 `/tmp/teamsight-p0/codex-config-before.toml`，权限 0600。临时宿主自动化已清理。验收结束后可只移除本次 MCP 段并使用下列命令正常停止服务，不能整份覆盖用户后续配置。

```sh
node artifacts/releases/teamsight-p0-darwin-arm64/dist/cli.js stop --data-dir .local/teamsight-p0-host
```

真实卡片及凭据范围核查已完成，Bundle 限制经用户实查记录，按已验证的 JS + HTTP 方式交付。本轮没有产品源码变化，原验证包和 Windows 交接继续有效。P0 本轮成果可提交确认，只有用户明确确认当前阶段通过，才收敛并实施 P1a。

## Artifacts

- [Codex 宿主补充验收报告](20261028_teamsight-p0-codex_测试报告.md)、[真实 UI 操作审计](20261028_teamsight-p0-codex_evidence/ui-audit.json)、[最终打开返回](20261028_teamsight-p0-codex_evidence/final-open.json)
- [批准的分阶段实施计划](../plan/20261028_teamsight-v1.2-phased-implementation.md)
- [技术方案 v1.2](../plan/20261027_2341_teamsight-server-mcp-apps-technical-plan.md)：已同步 P0 macOS 优先、Windows 延后及 P1c 必须补齐的门槛。
- [服务说明与运行命令](../../apps/server/README.md)
- [Windows 验收执行文档](../../docs/validation/teamsight-p0-windows.md)：包内也随附该文档，包含 PowerShell、MCP 配置、Apps 操作、证据模板和接力提示词。
- [macOS 验证包](../releases/teamsight-p0-darwin-arm64.zip)、[Windows 验证包](../releases/teamsight-p0-win32-x64.zip)、[压缩包校验清单](../releases/SHA256SUMS.txt)
- [独立包验收 JSON](20261028_teamsight-p0_evidence/acceptance.json)、[中文 PNG](20261028_teamsight-p0_evidence/probe.png)
- [构建及测试日志](20261028_teamsight-p0_evidence/package-build.log)、[独立目录运行与哈希检查](20261028_teamsight-p0_evidence/independent-package.log)、[旧 Tauri 构建](20261028_teamsight-p0_evidence/legacy-tauri-build.log)、[Node 诊断](20261028_teamsight-p0_evidence/runtime-diagnostics.log)
- [宿主配置识别](20261028_teamsight-p0_evidence/codex-config-check.log)、[真实自动调用](20261028_teamsight-p0_evidence/host-scheduled-call.log)、[自动化与清理记录](20261028_teamsight-p0_evidence/host-automation.json)
- [macOS 版本清单](20261028_teamsight-p0_evidence/versions-macos.json)、[Windows 版本清单](20261028_teamsight-p0_evidence/versions-windows.json)
- [正式运行知识](../../knowledge/teamsight-server-runtime-notes.md)：已于 2026-10-28 按用户要求由候选提升；保留原验收范围与限制。
