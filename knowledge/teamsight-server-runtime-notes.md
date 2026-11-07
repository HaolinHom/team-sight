# TeamSight Server / MCP Apps 运行知识

> 适用版本：MCP 0.3.2。基础运行规则于 2026-11-06 按源码复核，2026-11-07 更新版本资源与无迁移升级边界；本机服务实时状态需调用 teamsight_status，不以历史部署记录代替。

## 工程与服务入口

服务位于 `apps/server`，Vue MCP Apps 位于 `apps/mcp-ui`，共享计算与 TAPD 客户端位于 `packages/core`、`packages/tapd`。根 `src`、`src-tauri`、Rust 和旧路由已退役。根 `pnpm build`、`pnpm test` 转发全部 MCP 构建和测试，包级构建先清理 dist；Vue 依赖由 MCP UI 自身声明。

使用 Node.js 22.14+ 且低于 23、Node-API 10、pnpm 10.12.4。当前注册 37 个工具与 `ui://teamsight/settings-0.3.2.html`、`ui://teamsight/analysis-0.3.2.html` 两项资源。旧 probe、导入接口、tapd_list_workspaces 别名、p0/p1a/p1b 命令及旧资源地址已移除，旧卡片须重新打开。

服务、MCP、SQLite 和资源管理共用一个 Node 进程。HTTP 仅监听 127.0.0.1，校验 Bearer、Host 和 Origin；MCP 路径为 /mcp，Apps 通过宿主桥通信。只保留 `TEAMSIGHT_DATA_DIR` 和 `TEAMSIGHT_UI_PATH`（正式设置 HTML 覆盖路径），停止接口为经鉴权的 `POST /_internal/stop`。开发启动、doctor 和隔离验收命令见[服务 README](../apps/server/README.md)。

## 正式存储与离线迁移

默认开发数据目录为 `.local/teamsight-mcp`，数据库 `teamsight.sqlite`、user_version 4，配置 schema v6，系统钥匙串服务 `TeamSight.MCP`。settings 表是唯一配置修订来源，credentials 仅保存凭据引用。配置范围见[配置知识](teamsight-mcp-config-scope.md)。

`node dist/cli.js migrate --from OLD --to NEW` 仅接受旧 MCP `probe.sqlite` v3／配置 v5，不提供 Tauri JSON 导入或启动时自动兼容。源须离线且无运行锁；目标须不存在、不位于源目录内，父目录须存在。路径先解析真实路径再检查嵌套。迁移期间以 .migration 和 instance.lock 阻止目标启动。

迁移保留源数据和源凭据，以及有效配置字段、revision、缓存、回执、作业、文件索引、访问令牌和历史文件。旧 TeamSight.P0 凭据在钥匙串内复制至 TeamSight.MCP 并读回校验，不写入数据库、文件或日志。持久化审计比较 JSON 语义，避免将 undefined 可选属性与省略属性误判为差异。

失败不切换服务，并清理本次新增目标及凭据；凭据补偿失败返回 `MIGRATION_CREDENTIAL_CLEANUP_REQUIRED`，保留锁定目标及凭据引用供处理。回退使用原数据和旧启动配置，不能用新版数据直接覆盖原目录。

## 查询快照与缓存

- 工时源缓存仅保存完整查询的快照引用，保留原 fetchedAt，TTL 为 60 秒；refresh 绕过缓存。此缓存不同于下述排期 calculationId 的 30 分钟有效期。
- 工时缓存键包括服务地址、凭据摘要、排序后的项目／成员身份、完成状态配置、范围及计算日，不包含别名、展示顺序和纯计算规则。分析重新应用当前项目别名／颜色、工时与日历规则；旧分析仍保持原快照，不会随设置自动改写。
- 业务写入及远端核验成功时清除缓存并递增缓存 generation，阻止此前在途查询重新发布缓存；场景配置更新和项目同步也清除持久缓存。不存在旧桌面的 Web Worker、KeepAlive 或 512 项／40000 行响应缓存约定。

## 排期、模拟与批次恢复

- 普通补排期释放原任务的预计占用，保留 actual；每日可用容量为 max(target - actual - 其他预计占用, 0)。跨项目共用同一分析，取数不完整或当天有缺口原因时保持 unknown。
- 候选、依赖和每日分配来自当前输入与分析，没有独立持久化计划／依赖表。计算保存在进程内 Map，30 分钟过期、最多 50 条；过期或重启后须重新计算。
- 搜索使用有预算的确定性枚举及回溯，最多访问 50,000 状态。候选可行不等于全局最优，search_incomplete 或未命中不证明无人承接；只有明确约束失败才可解释为对应 infeasible。
- 紧急 direct／reallocate／multi 均为只读模拟，批次写入拒绝 urgent 计算。旧研发任务移动边界结合同需求最早完整测试排期、需求截止日和计算窗口；同日交接须显式允许，测试上下文不完整则锁定。
- 模拟视图按候选日期及分配重算容量、状态和风险，不能沿用基线风险冒充调整结果。
- batchKey/ref 对应的 batchId、itemKey、attempt、intentHash 随回执在 POST 前持久化。同幂等键同请求复用，异请求冲突；成功项复用，明确 failed 仅在 retryFailed 时新建尝试，unknown 不自动重发。
- unknown 先只读核对远端：有 remoteId 则读回，无 ID 则搜索并提供 candidateId 核验。未确认前保留未知，不能按本地无成功回执推断远端未执行。
- 恢复将 pending 标 failed、in_flight 标 unknown、运行中作业标 interrupted。部分成功不自动删除远端任务；本地回执不保证远端恰好执行一次。
- 日期批次须基于有效普通排期；写入前重新分析并比较来源指纹，变化返回 STALE_PLAN 及重算结果。续办沿用原 batchKey/ref，成功项不重复创建，剩余项重新校验。

源码：[业务与缓存](../apps/server/src/business.ts)、[场景及批次](../apps/server/src/scenarios.ts)、[搜索器](../packages/core/src/planner.ts)、[回执与恢复](../apps/server/src/business-storage.ts)、[存储](../apps/server/src/storage.ts)。

## 运行包、升级与验收边界

运行包不含 Node、TAPD 配置或令牌，按平台复制无符号链接的生产依赖并准备原生模块。versions.json 记录源码哈希，checksums.json 记录文件哈希；不能只用 Git HEAD 标识未提交实现。实际构建和验收应显式选择并记录 Node 版本。

Windows 可通过 `TEAMSIGHT_MCP_NATIVE_CACHE` 显式引用可信同目标包；复用前校验目标、依赖版本、完整文件集合及 SHA-256，拒绝符号链接并记录来源清单哈希。结构、哈希及 PE 校验不代表 Windows 原生模块加载通过。详见[打包脚本](../scripts/package-mcp.mjs)与[平台验收](../docs/validation/teamsight-mcp-platforms.md)。

KeepAlive LaunchAgent 升级先验证运行包、doctor 和隔离 MCP，检查无活动分析或待发送写入，再 bootout 并确认旧进程退出，备份静止数据与启动配置，更新脚本并 bootstrap。跨存储版本时还须隔离迁移与迁移核对；0.3.1 → 0.3.2 沿用 DB v4／配置 v6，不执行迁移。保留旧包、源数据和旧钥匙串条目；失败时停止新版并恢复旧启动配置，不删除未知实例的锁。

[0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)保存该版本的构建、回归、迁移、历史导出和 macOS 升级证据。测试数量、PID、revision、项目数及安装目录属于该次验收记录，不作为当前环境常量。Windows 实机、Linux、其他架构、原生 Apps 完整交互、真实 TAPD 写入及重启／休眠仍需对应验收；隔离浏览器和 app-only 可见性不代表原生宿主完整验收或凭据保密保证。

[0.3.2 展示精简与更新报告](../artifacts/report/20261107_甘特图展示精简与MCP032_测试报告.md)记录当次 macOS arm64 安装、状态及资源哈希核对、配置／凭据／历史文件保留验证。130 项回归及隔离浏览器通过，Windows 0.3.2 未构建，原生侧栏无可用 App tab，原生完整交互与视觉仍未验收。部署状态是当次证据，不替代实时 teamsight_status。

本次知识提升仅静态核对，未重新构建、部署或执行业务测试。迁移实现见[迁移模块](../apps/server/src/migration.ts)，服务注册见[server](../apps/server/src/server.ts)。
