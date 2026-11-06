# TeamSight Server / MCP Apps 运行知识

> 2026-11-06 经用户授权提升 MCP 0.3.0 候选。下述当前实现已核对源码；本机部署及测试结果来自同日实施报告，是当时的 macOS arm64 验证记录。其他平台、宿主及后续版本需单独核验。

## MCP 0.3.0 工程与入口

仓库已收敛为 MCP 工程：服务位于 `apps/server`，Vue MCP Apps 位于 `apps/mcp-ui`，共享计算与 TAPD 客户端位于 `packages/core`、`packages/tapd`。根 `src`、`src-tauri`、Tauri/Rust/旧路由依赖及桌面专用入口已删除。根 `pnpm build`、`pnpm test` 转发完整 MCP 构建和测试；包级编译先清理 dist，避免旧模块残留进入运行包。Vue 与 UI 测试依赖由 MCP UI 自身声明，详见[前端测试知识](frontend-testing-notes.md)。

当前工具共 37 个；6 个 `teamsight_probe_*`、`teamsight_import_settings`、`tapd_list_workspaces` 别名和 p0/p1a/p1b 命令、打包转发、旧验收入口已退役。仅注册 `ui://teamsight/settings-0.3.0.html` 和 `ui://teamsight/analysis-0.3.0.html`；旧卡片需要重新打开。TAPD 自身仍有效的旧链接格式继续支持，不能按 legacy 字样泛化删除。

服务、MCP、SQLite 和资源管理共用一个 Node 进程，HTTP 仅监听 127.0.0.1，验证 Bearer、Host 和 Origin；MCP 路径为 /mcp，Apps 通过宿主通信桥。环境变量保留 `TEAMSIGHT_DATA_DIR` 与 `TEAMSIGHT_UI_PATH`，后者覆盖正式设置 HTML；`TEAMSIGHT_P0_*` 不再生效。停止接口统一为 `POST /_internal/stop`。当前验收入口为 `node dist/cli.js doctor`、`node verify-mcp.mjs`（运行包内）。

## 正式存储与显式离线迁移

默认开发数据目录为 `.local/teamsight-mcp`，数据库为 `teamsight.sqlite`、user_version 4，配置 schema v6，系统钥匙串服务为 `TeamSight.MCP`。正式 settings 表是唯一配置修订来源；credentials 表仅保存凭据引用，不保存秘密。配置与工时规则见[配置知识](teamsight-mcp-config-scope.md)。

`node dist/cli.js migrate --from OLD --to NEW` 仅接受旧 MCP `probe.sqlite` v3／配置 v5，不提供 Tauri JSON 导入或启动时自动兼容。源目录必须离线且无运行锁；目标必须不存在、不位于源目录内，父目录必须存在。迁移期间目标通过 `.migration` 和 instance.lock 阻止服务启动。源数据和源凭据保留，迁移保留配置 revision、有效业务字段、缓存、回执、作业、文件索引、访问令牌和全部历史文件。

旧 `TeamSight.P0` 凭据直接在系统钥匙串中复制至 `TeamSight.MCP` 并读回验证，不写入数据库、文件或日志。任一步失败不切换服务，并清理本次新增的目标凭据和目标目录；若凭据清理失败，返回 `MIGRATION_CREDENTIAL_CLEANUP_REQUIRED`，保留锁定目标和凭据引用以便处理，源保持可恢复。

路径检查先将源及目标父路径解析为真实路径，再判断嵌套关系，避免 macOS `/var` 与 `/private/var` 等同路径绕过检查。持久化配置审计应比较 JSON 语义，避免把 undefined 可选属性和 JSON 省略属性误判为迁移差异。

## 排期计算、模拟与批次恢复

> 2026-11-06 经用户授权提取仍适用的 0.2 候选机制，按 MCP 0.3.0 源码复核；不恢复旧配置、旧规则或 P0 兼容入口。

### 容量、搜索与计算有效期

- 普通补排期释放原任务的预计占用，保留 actual；每日可用容量按 max(target - actual - 其他预计占用, 0) 计算。跨项目容量共用同一分析，取数不完整或当天存在缺口原因时仍标 unknown。
- 候选、依赖与每日分配来自当前输入和 TAPD 分析，没有独立持久化的计划／依赖表。计算对象保存在进程内 Map，30 分钟过期、最多 50 条；过期或重启后必须重新计算，不能仅凭旧 calculationId 写入。
- 搜索采用有预算的确定性枚举与回溯，最多访问 50,000 状态。找到候选只证明该候选可行，不保证全局最优；search_incomplete 或候选枚举未命中不证明无人承接。只有明确的约束失败才可按对应 infeasible 原因解释。
- 紧急 direct／reallocate／multi 均为只读模拟，批次写入拒绝 urgent 计算。移动旧研发任务时结合同需求最早完整测试排期、需求截止日与计算窗口确定边界；同日交接须显式允许，测试上下文不完整时保持锁定。
- 模拟视图使用候选日期与每日分配重新计算容量、状态和风险；图表与结构化结果使用同一模拟事实，不能沿用基线风险冒充调整结果。

### POST 前持久化与续办

- batchKey/ref 对应的 batchId、itemKey、attempt、intentHash 必须随原操作回执在 POST 前持久化；不能等远端写入后再补关联，否则中断后无法可靠恢复。
- 相同幂等键且请求哈希一致时复用原回执；不同请求返回冲突。批次成功项复用，明确 failed 的项仅在 retryFailed 时新建尝试；unknown 不自动重发。
- unknown 先只读核对远端；已有 remoteId 时可读回匹配，无 ID 时先搜索并提供 candidateId 再核验。未证实远端状态前保留未知，不能因本地没有成功回执就认定远端未执行。
- 进程恢复将 pending 标 failed、in_flight 标 unknown，运行中作业标 interrupted。部分成功不自动删除远端任务或回滚；本地幂等回执不保证远端恰好执行一次。
- 日期批次须基于有效普通排期。写入前重新分析并比较来源指纹，变化时返回 STALE_PLAN 并提供重算结果；续办保留原 batchKey/ref，已成功项不重复创建，剩余项基于新计算重新校验。

源码：[场景、计算与批次](../apps/server/src/scenarios.ts)、[搜索器](../packages/core/src/planner.ts)、[写入与核对](../apps/server/src/business.ts)、[回执及恢复](../apps/server/src/business-storage.ts)。[2026-11-03 报告](../artifacts/report/20261103_teamsight-mcp-capability-completion_测试报告.md)记录过两次受控真实 POST；该记录属于当时 0.2.0 验证，本次仅静态复核，不代表 0.3.0 真实写入或压力测试通过。

## 运行包、升级与回退

运行包不包含 Node 运行时；按 macOS arm64／Windows x64 复制无符号链接的生产依赖树，并准备对应原生模块。versions.json 记录工作区源码哈希，checksums.json 记录文件哈希；未提交实现不能仅用旧 Git HEAD 标识版本。实际执行时显式选择并记录 Node 版本，避免终端 PATH 恢复旧版本。Windows 包结构及 PE 检查不等于实机加载验收。

Windows 打包可用 `TEAMSIGHT_MCP_NATIVE_CACHE` 显式引用先前可信同目标包。复用前校验目标、依赖版本、完整文件集合及逐文件 SHA-256，拒绝符号链接，并记录来源 versions.json 的清单哈希。缓存校验不能证明 Windows 原生模块可运行。依据：[打包脚本](../scripts/package-mcp.mjs)、[历史打包报告](../artifacts/report/20261103_teamsight-mcp-capability-completion_测试报告.md)；本次未重新打包。

KeepAlive LaunchAgent 升级应先验证运行包、原生 doctor 和隔离迁移，再 bootout；确认旧实例退出后备份静止数据及启动配置，离线迁移并核对数据，再更新启动脚本并 bootstrap。验收前不执行真实 TAPD 写入，保留旧运行包、原数据和旧钥匙串条目。失败时停用新版服务、恢复旧启动配置并重新加载；不要删除未知实例的锁。

2026-11-06 本机已升级至 0.3.0，安装根为 `/Users/haolin/Library/Application Support/TeamSight MCP`，新目录 data-mcp；旧 data 和 versions/0.2.6 保留。沿用 `cn.teamsight.mcp` LaunchAgent、原访问令牌及 `127.0.0.1:43127`。配置 revision 23、9 个项目、5 名成员、67 个历史文件及业务表均核对一致；当前聊天连接和真实 TAPD 只读查询成功。这些是该次升级事实，后续使用应重新读取服务状态。

## 0.3.0 验证结果与边界

实施阶段使用 Node.js 22.23.2／Node-API 10、pnpm 10.12.4，完整构建及 110 项回归通过。macOS 原生 doctor、真实钥匙串隔离迁移、两平台运行包校验、历史 SVG/PNG/HTML 与报告导出通过。升级审计曾因 undefined 属性误判触发实际回退；修正比较方式后重新核对并成功切换。未执行 Git 提交、推送或真实 TAPD 写入。

Windows 仅完成包构建、结构／哈希及 PE 检查；Codex 原生 Apps 完整交互、真实 TAPD 写入、Linux、其他架构、系统重启／休眠及宿主定时精度未在本轮验证。隔离 SDK 浏览器验证不代表原生宿主完整验收，app-only 可见性也不是凭据保密保证。

依据：[0.3.0 实施测试报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)、[迁移实现](../apps/server/src/migration.ts)、[正式存储](../apps/server/src/storage.ts)、[CLI](../apps/server/src/cli.ts)、[服务注册](../apps/server/src/server.ts)。本次知识提升仅核对源码、报告和链接，没有重跑业务测试或重新部署。

## 历史记录：P0 原型（2026-10-28）

以下保留当时的验证过程和宿主限制；其中旧入口、旧 App 保留状态和原型命令均已被 0.3.0 退役，不作为当前操作指南。

> 验证与提升日期：2026-10-28。适用技术方案 v1.2 的 P0 原型；macOS 26.7 arm64，Codex 26.1016.62342 / build 21477、CLI 0.156.0。其他平台、宿主与版本需单独验收。
> 本文经用户明确要求由候选提升，仅记录已验证事实及其边界，不表示用户已确认 P0 阶段通过或授权实施 P1a。

## 已验证事实

- 旧 App 保留根目录 Vue/Tauri 入口。P0 服务位于 `apps/server`，Vue MCP Apps 原型位于 `apps/mcp-ui`，工作区使用 pnpm。正式核心提取及业务接口尚未实施。
- 已锁定并实际在 macOS arm64 运行的组合为 Node.js 22.23.4 / Node-API 10、pnpm 10.12.4；MCP core/server/client 2.4.0、Node adapter 2.1.2、Apps 2.0.4；better-sqlite3 13.0.3、keyring 2.1.2、resvg 2.6.2。
- MCP SDK 2 使用拆包及 Node 适配器，不能套用旧 SDK 1.x 的导入路径。Apps registerAppTool / registerAppResource 与非 React App 类可用于自包含 Vue 资源；当前 Codex 版本的真实表单打开、读写、冲突、失败重试和重启恢复已独立验证，其他宿主仍需验收。
- `pnpm p0:build` 构建原型；`pnpm p0:test` 验证契约；`node apps/server/verify.mjs` 用两个真实客户端与两次真实服务进程验证持久化及 native 能力。自动脚本通过不等于 Codex Apps 或宿主调度通过。
- 服务、MCP、SQLite 和资源管理共用一个 Node 进程。HTTP 只监听 127.0.0.1，Bearer、Host 和 Origin 同时验证；MCP 使用 /mcp，Apps 通过宿主通信桥。
- better-sqlite3 使用 WAL 和同步短事务。锁等待实测约 1 秒，期间阻塞事件循环；异步函数外壳不能消除这种阻塞。P0 的测试凭据存在系统凭据库，SQLite 只保留 UUID 引用和配置修订。
- JS 验证包没有 Node 运行时，不依赖安装者编译 native；以无符号链接的生产依赖树分平台交付。Windows optional native 包需要在构建时额外准备；结构及 PE 校验不等于 Windows 实际加载验收。
- 包中 versions.json 包含工作区源码哈希，checksums.json 包含内容哈希。未提交实现不能只以旧 Git HEAD 标识版本。
- macOS 下 iTerm 提示符可能恢复旧 Node PATH；应在实际构建/验收脚本内显式选择锁定版本并记录 node --version。仅安装新版本不证明测试已使用新版本。
- 在本次 Codex 会话中，模型仅发现状态、打开设置和渲染三个工具，app-only 读写及凭据动作由真实卡片经宿主桥调用；此可见范围是当前宿主观察，不是权限或保密保证。UI 密码输入、服务/SQLite/宿主日志应分别核查，不能把 Agent 自己填写测试哨兵的脚本记录当作 UI 泄漏证据。
- 两张 Apps 卡片持有独立配置修订，可复现实测旧修订冲突；它与两个不同 Codex 对话线程的 UI 验收是不同范围，报告必须注明。当前正常服务重启后，原卡片可重新读取配置并核对系统测试凭据；未扩大到崩溃、休眠或自动启动。

## 验收边界与已知限制

当前 Codex 版本的 MCP 设置页经用户实查只有命令/URL 配置，未见 `.mcpb` 文件导入入口；本轮按已验证的 JS + HTTP 路径交付，没有执行文件安装，也不扩大为所有版本或插件入口都不支持。凭据核查只覆盖本轮可访问的结果、日志与存储，没有承诺宿主内部不记录秘密。宿主自动化已真实调用同一服务并清理，但精确时刻语义存在偏差。Windows、其他架构、STDIO 和 Linux 均不能写成通过。

## 依据

后续 MCP 0.2.4 的工时盒子、抽屉、嵌入视口及本机升级记录见 [MCP 甘特图交互知识](./mcp-gantt-interaction-notes.md)。本文前述 P0 事实保留其历史阶段范围；后续版本不应直接套用“业务接口尚未实施”等 P0 状态描述。

[P0 macOS 验收报告](../artifacts/report/20261028_teamsight-p0-macos_测试报告.md)及[Codex 宿主补充报告](../artifacts/report/20261028_teamsight-p0-codex_测试报告.md)中的版本清单、自动测试、独立运行、真实卡片、系统凭据和中文 PNG 证据。引用这些结论时，应保留平台、宿主版本、接入方式和取证范围的边界。
