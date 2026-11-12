# TeamSight Server / MCP Apps 运行知识

> 适用版本：MCP 0.3.3。基础运行规则于 2026-11-06 按源码复核，2026-11-09 复核双版本发行、运行时选择与无迁移升级边界，2026-11-12 静态复核 macOS HTTP 安装器并完成 Windows 10 x64 构建、双包原生运行、用户级后台安装及 Codex 连接设置卡片验收；本机服务实时状态需调用 teamsight_status，不以历史部署记录代替。

## 工程与服务入口

服务位于 `apps/server`，Vue MCP Apps 位于 `apps/mcp-ui`，共享计算与 TAPD 客户端位于 `packages/core`、`packages/tapd`。根 `src`、`src-tauri`、Rust 和旧路由已退役。根 `pnpm build`、`pnpm test` 转发全部 MCP 构建和测试，包级构建先清理 dist；Vue 依赖由 MCP UI 自身声明。

源码构建使用 Node.js 22.14+ 且低于 23、Node-API 10+、pnpm 10.12.4；发行包运行无需 pnpm。推荐自带运行时版，精简版须自行提供满足上述范围的 Node。当前注册 37 个工具与 `ui://teamsight/settings-0.3.3.html`、`ui://teamsight/analysis-0.3.3.html` 两项资源。旧 probe、导入接口、tapd_list_workspaces 别名、p0/p1a/p1b 命令及旧资源地址已移除，旧卡片须重新打开。

服务、MCP、SQLite 和资源管理共用一个 Node 进程。HTTP 仅监听 127.0.0.1，校验 Bearer、Host 和 Origin；MCP 路径为 /mcp，Apps 通过宿主桥通信。服务运行环境覆盖入口为 `TEAMSIGHT_DATA_DIR` 和 `TEAMSIGHT_UI_PATH`（正式设置 HTML 覆盖路径），停止接口为经鉴权的 `POST /_internal/stop`。开发启动、doctor 和隔离验收命令见[服务 README](../apps/server/README.md)。

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

同一版本按平台生成 bundled（自带运行时，默认推荐）与 external（精简）两种包，不附带 TAPD 配置或令牌。`pnpm mcp:package` 默认当前主机目标；显式指定 `darwin-arm64` 或 `win32-x64` 时生成该平台两种包，`pnpm mcp:package all` 生成四份。每个平台只准备一次服务、前端与生产依赖，再复制为两种包；业务文件和生产依赖保持一致，运行时、固定模式入口与发行清单按包类型区分。

产物位于 `artifacts/releases/<版本>`，保留解压目录；归档名为 `teamsight-mcp-<版本>-darwin-arm64-{bundled,external}.tar.gz` 或 `teamsight-mcp-<版本>-win32-x64-{bundled,external}.zip`，另附归档 SHA-256 清单。拒绝覆盖既有产物；先在临时目录准备，失败清理本次暂存与本次已发布文件，保留旧包。生产依赖复制时拒绝符号链接，SQLite 原生依赖的打包方式不变。

bundled 固定使用官方 Node **22.23.4**；下载地址及归档 SHA-256 固定于[运行时打包模块](../scripts/package-mcp-lib.mjs)，下载后先校验，`.local/node-runtime-cache` 缓存复用也须校验，损坏缓存直接报错，不自动跟随 latest。仅提取可执行文件与 LICENSE 到 `runtime`，不带 npm、npx 或开发头文件。入口明确使用私有 Node，校验可执行文件哈希；缺失或损坏直接失败，不回退系统 Node。启动时清除子进程的 `NODE_OPTIONS`、`NODE_PATH`，不安装全局 Node、不修改系统 PATH 或 nvm 配置。

external 不带 Node，从进程 PATH 查找外部 Node，要求 **>=22.14.0 且 <23、Node-API >=10**；缺失或不兼容时给出诊断。不要直接用系统 `node` 绕过包内入口：服务 CLI 统一用 `launch.sh`／`launch.ps1`，通用 Node 脚本用 `run-node.sh`／`run-node.ps1`，两者共用固定的运行时选择。入口保留含空格路径的参数与退出码。

在解压目录中，macOS 使用 `./launch.sh doctor`、`./run-node.sh verify-mcp.mjs --evidence-dir ./evidence`、`./launch.sh serve --data-dir /绝对数据路径 --port 43127`；另一终端用相同 data-dir 执行 `status`／`stop`。状态辅助脚本通过 `./run-node.sh status-mcp.mjs /绝对数据路径` 调用。Windows 对应入口为 `.\launch.ps1`、`.\run-node.ps1`，沿用用户现有 PowerShell 执行策略；具体命令见[平台验收](../docs/validation/teamsight-mcp-platforms.md)。

每种包独立生成 `versions.json` 和 `checksums.json`：前者记录源码哈希、依赖版本、variant、runtimeBundled、buildNode；自带版额外记录 Node 版本、官方来源、归档与可执行文件 SHA-256。后者记录包内文件哈希。不能只用 Git HEAD 标识未提交实现，也不能把构建 Node 当作实际验收 Node：打包时 `validatedNode: null`、runtimeAcceptance 待验收，真实运行版本及结果写入独立报告／JSON，不回写封存的压缩包。

Windows 可通过 `TEAMSIGHT_MCP_NATIVE_CACHE` 显式引用可信同目标包；复用前校验目标、依赖版本、完整文件集合及 SHA-256，拒绝符号链接并记录来源清单哈希。结构、哈希及 PE 校验不代表 Windows 原生模块加载通过。详见[打包脚本](../scripts/package-mcp.mjs)与[平台验收](../docs/validation/teamsight-mcp-platforms.md)。

KeepAlive LaunchAgent 升级先验证运行包、doctor 和隔离 MCP，检查无活动分析或待发送写入，再 bootout 并确认旧进程退出，备份静止数据与启动配置，更新脚本并 bootstrap。跨存储版本时还须隔离迁移与迁移核对；0.3.1／0.3.2 → 0.3.3 以及两种包切换均沿用 DB v4／配置 v6，不执行迁移。切换前停止旧实例，使用同一绝对 data-dir，不覆盖正在运行的包。保留旧包、源数据和旧钥匙串条目；失败时停止新版并恢复旧启动配置，不删除未知实例的锁。

[0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)保存该版本的构建、回归、迁移、历史导出和 macOS 升级证据。测试数量、PID、revision、项目数及安装目录属于该次验收记录，不作为当前环境常量。该轮未验收 Windows 实机；当前 Windows 0.3.3 验收见下节。Linux、其他架构、原生 Apps 完整交互、真实 TAPD 写入及重启／休眠仍需对应验收；隔离浏览器和 app-only 可见性不代表原生宿主完整验收或凭据保密保证。

[0.3.2 展示精简与更新报告](../artifacts/report/20261107_甘特图展示精简与MCP032_测试报告.md)记录当次 macOS arm64 安装、状态及资源哈希核对、配置／凭据／历史文件保留验证。130 项回归及隔离浏览器通过，Windows 0.3.2 未构建，原生侧栏无可用 App tab，原生完整交互与视觉仍未验收。部署状态是当次证据，不替代实时 teamsight_status。

[0.3.3 双版本发行报告](../artifacts/report/20261109_双版本发行_mcp033_测试报告.md)记录原有 130 项与新增 6 项测试、四份归档完整性／无符号链接／公共业务文件一致性，以及 macOS 两种包的 doctor、隔离 MCP、启动／状态／停止、SQLite、钥匙串、中文 PNG、运行时选择及数据兼容检查。精简版在 Node 22.14.0、22.23.4 下完成对应验收；该轮 Windows 仅通过归档、清单和 PE x64 检查，后续原生验收见下节。

[0.3.3 精简版本机升级报告](../artifacts/report/20261109_精简版更新MCP033_测试报告.md)记录后续经授权的 LaunchAgent 升级、配置／凭据／历史数据保留及工具／资源哈希核对。安装目录、包大小、PID、revision 等均为点时证据，不作为长期常量；当前服务状态仍须实时查询。Codex 原生 Apps 完整交互、真实 TAPD 写入与系统重启未在该轮验收。

## Windows 构建、用户级安装与验收

Windows 10 x64 已使用 Node 22.23.4（Node-API 10）、pnpm 10.12.4 完成冻结锁文件安装、构建与测试。开发 Node 可由 nvm-windows 通过 `nvm install 22.23.4 64`、`nvm use 22.23.4` 管理；22.13.x 不符合最低要求。`better-sqlite3` 使用依赖包附带的 Windows x64 预编译模块；两种发行包已真实验证 SQLite、`@napi-rs/keyring` 凭据写入／读回／清理及 resvg PNG，不能以 PE 或打包成功替代这些检查。

Windows 单平台双包验收入口为 `node scripts/verify-mcp-packages.mjs RELEASES EVIDENCE win32-x64`；`TEAMSIGHT_TEST_OLD_NODE` 指向已安装的不兼容 Node 目录，用于 external 版错误诊断。脚本优先使用 PowerShell 7，可通过 `TEAMSIGHT_POWERSHELL` 指定路径，未找到时回退 Windows PowerShell。两种 PowerShell 的执行策略可能不同，须沿用所选宿主现有策略，不自动降低或绕过。本机在 PowerShell 7 既有策略下通过，不代表其他电脑或 PowerShell 5.1 已验收。

本地安装器要求 PowerShell 7，仅消费已解压的 win32-x64 bundled 包，不提供公网下载；external 可手动运行并参与发行验收。维护者先执行 `pnpm mcp:installer:windows:build`，再执行 `pwsh -NoProfile -File .local/windows-manager/install-windows.ps1 -Action Install -PackagePath /绝对路径/teamsight-mcp-win32-x64-bundled`；隔离安装验收为 `pnpm mcp:installer:windows:verify`。入口与实现见[安装管理](../scripts/install-windows.ps1)、[构建器](../scripts/build-windows-manager.mjs)、[发行验收](../scripts/verify-windows-packages.mjs)、[隔离安装验收](../scripts/verify-windows-installer.mjs)。

默认安装根 `%LOCALAPPDATA%\TeamSight MCP`，程序位于 `versions/0.3.3-bundled`，数据 `data-mcp`、日志 `logs`、备份 `backups`，管理状态为 `installer-state.json`。后台使用当前用户 SID 的 Interactive／Limited／Hidden 登录计划任务，固定 PowerShell 和包内 Node 的绝对路径，关闭安装进程及后续切换 nvm 不影响运行。默认端口 43127；`-InstallRoot`、`-CodexHome`、`-Port` 可用于隔离验收。使用 `pwsh -NoProfile -File "$env:LOCALAPPDATA/TeamSight MCP/install-windows.ps1" -Action Status` 查询，同入口支持 Start、Stop、Uninstall；Stop 同时禁用登录任务，Start 重新启用。卸载移除匹配的 Codex 连接、任务和版本程序，保留数据、访问令牌、系统凭据、日志与备份。

安装器复用 TOML 结构编辑设置静态 Authorization，保留其他连接及审批策略；含令牌的文件和备份以当前用户、SYSTEM、Administrators 的 ACL 保护，不输出令牌。任务计划程序可能将域账号显示为短用户名，身份应转换为 SID 比较。重复设置权限时应仅写入 DACL；本次 Set-Acl 路径出现普通用户缺少 SeSecurityPrivilege，使用 `.NET FileSystemAclExtensions.SetAccessControl` 写入 DACL 后通过重复安装验收。未知实例锁、端口占用不接管；配置失败的服务／任务／新程序回滚已通过隔离实测，不能扩展解释为所有故障路径均已覆盖。

Windows 无开发者模式时可用目录 junction 验证链接拒绝；macOS LaunchAgent 专属测试明确跳过，不在 Windows 调用 `process.getuid`。Windows 包已验证中文／空格路径、参数及退出码、两包共享数据、bundled 不依赖外部 Node，以及运行时缺失／损坏／不兼容诊断。验收结果保存在独立 JSON，不回写封存归档。

[2026-11-12 Windows 报告](../artifacts/report/20261112_1622_windows-mcp_测试报告.md)记录 148 项通过、2 项 macOS 专属测试跳过、双包原生运行和 6 组隔离安装管理场景，以及正式安装的 37 工具／2 资源与 Codex 宿主实例匹配。用户刷新连接后确认连接设置卡片正常显示。完整分析卡片交互、真实 TAPD 业务、重新登录、系统重启与休眠恢复仍未验收；任务定义和任务重启不能代替真实登录／重启结果，设置卡片不能代替完整 Apps 验收。本机代理端口、PID、任务名、配置修订及下载故障仅为当次环境事实，不作为通用配置。

## macOS HTTP Agent 安装与后台管理

独立 [install.sh](../scripts/install.sh) 当前支持 **0.3.3／macOS arm64**，bundled、external 两种包，默认 bundled。可复制给 Agent 的固定下载命令见[安装说明](../docs/install/macos-agent-install.md)。脚本不附入或改写已封存的运行包；消费端无需 GitHub CLI、GitHub Token、源码、Python、npm 或 pnpm，external 仍须提供兼容的 arm64 Node。

安装说明先以 HTTPS GET 下载固定提交的脚本，校验 SHA-256 后执行，不用 curl 管道直接执行。脚本再通过固定 GitHub Release 地址下载对应归档，校验内置归档 SHA-256 后提取，并检查包内文件集合／哈希和符号链接。下载有连接及总超时，只允许 HTTPS 重定向；不跟随 latest，不在 HTTP 错误或哈希失败后更换来源。公开脚本快照、Release 资产及匿名下载可用是分发前置条件；生成固定地址不代表已推送或已上线。

参数为 `--version 0.3.3`、`--variant bundled|external`、external 可选 `--node /绝对路径/node`，默认端口 43127。bundled 使用包内 Node；external 从显式路径或当前 PATH 选择 Node，校验版本／Node-API／arm64，并将其真实绝对路径固定于启动脚本，不安装系统 Node、不更改 nvm 或全局 PATH。安装器及后台子进程清除 NODE_OPTIONS／NODE_PATH。手工解压运行沿用上一节入口；安装器的 external 启动由已验证的绝对 Node 路径调用 CLI，不依赖登录 shell 载入 nvm。

生产安装根目录为 `~/Library/Application Support/TeamSight MCP`：程序位于 `versions/0.3.3-<variant>`，数据为 `data-mcp`，日志为 `logs`，备份为 `backups`，管理状态为 `installer-state.json`。归档校验后仅解除本次提取目录的下载隔离标记，不关闭系统 Gatekeeper；解除隔离不等于 Apple 签名或公证。doctor 校验 SQLite、系统钥匙串、PNG，再执行隔离 MCP；通过后创建用户级 `cn.teamsight.mcp` LaunchAgent，立即及登录后启动，关闭安装终端后仍可用。桌面登录会话、钥匙串授权或系统权限提示可能需要用户本人处理。

安装器尊重 CODEX_HOME，缺省使用 `~/.codex/config.toml`；备份后以 TOML 语法树更新 `mcp_servers.teamsight`，保留其他连接、注释及工具审批策略，并清理被替换连接的旧启动／认证字段。将本机 data-mcp/access-token 写入 `http_headers.Authorization`，配置及备份文件为 0600，目录按 0700 创建，不依赖 Codex 桌面进程继承终端环境变量。此本机访问令牌与 TAPD 凭据不同；TAPD 凭据仍在设置卡片填写。配置、备份和令牌不得贴到对话或公开日志。

安装完成会真实连接 MCP，核对版本、37 个工具及 teamsight_status，再分别报告服务验证和 Codex 配置结果；`codexConnection: reconnect-required` 不表示当前宿主已重载。按提示重新连接或重启 Codex 后另行验证工具和原生 Apps，安装器不会主动中断当前会话。

同版本重复安装及两种包切换会核对管理状态、文件哈希和实例身份，并检查 DB v4／配置 v6、running 作业及 pending／in_flight 写入。安全停止原管理服务后备份静止数据，再切换；未知实例、手工维护的旧启动项、端口冲突、不支持的数据格式或被修改的管理文件会拒绝操作，不结束未知进程、不删除实例锁。失败路径恢复本次修改的管理文件及原服务，Codex 若被并发修改则不覆盖；恢复失败返回 ROLLBACK_REQUIRED，保留备份供处理。INSTALLER_LOCKED 须先确认没有安装进程，不能盲目删锁。

已校验的同一脚本可用 `--status` 查询、`--uninstall` 卸载；操作要求安装器管理状态及所选运行时可用。卸载删除管理服务、匹配的 TeamSight 连接和安装器创建的程序，保留数据、access-token、备份及系统钥匙串凭据；已被手工改变的连接或管理文件不会被强制接管。

维护者使用 `pnpm mcp:installer:build` 从源码生成单文件（内嵌固定 TOML 解析依赖及许可证），`pnpm mcp:installer:verify` 做隔离验收，`pnpm mcp:installer:prepare` 生成固定脚本快照、SHA-256 和安装说明。prepare 只创建本地脚本 Git 快照及保护引用，不推送、不上传资产、不修改工作分支／暂存区或仓库可见性；修改源码后须重新生成并验证，不直接编辑生成脚本。实现见[安装入口源码](../scripts/installer/bootstrap.sh)、[安装与恢复](../scripts/installer/main.mjs)、[配置编辑](../scripts/installer/config.mjs)、[构建器](../scripts/build-installer.mjs)、[快照准备](../scripts/prepare-installer-release.mjs)。

路径校验须先 resolve 归一化，再截取相对文件键；macOS TMPDIR 尾斜杠可能叠出双斜杠，直接按原字符串长度截取会误报文件哈希。对应回归见[安装器测试](../scripts/test/installer.test.mjs)。

[2026-11-10 安装器报告](../artifacts/report/20261110_macos-http-agent-install_测试报告.md)记录 Node 22.23.4 下 148 项回归与 17 组真实 HTTPS／原生模块／隔离 LaunchAgent 场景通过，未切换生产 MCP、未改四份封存归档。当次脚本固定地址 GET 为 404、Release 连接超时，未完成公网与接收端 Codex 验收；这是当时证据，本次知识提升未重查线上状态。分发前须核对当前发布状态并完成匿名下载、接收端安装及宿主连接验收。LaunchAgent 重载不替代系统重启／重新登录验收，原生 Apps、实际 Gatekeeper 弹窗、首次钥匙串授权、签名公证及其他平台仍需对应验收。

本次知识提升静态核对源码、报告及已保存的 Windows 实测证据，未重新构建、部署或执行业务测试。迁移实现见[迁移模块](../apps/server/src/migration.ts)，服务注册见[server](../apps/server/src/server.ts)。
