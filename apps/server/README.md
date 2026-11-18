# TeamSight MCP 服务管理

适用版本：**0.3.5**（Windows 后台安装示例仍适用于 **0.3.4**）。本文面向需要手动接入、管理本地服务或进行源码开发的用户。产品介绍与首次使用见[项目 README](../../README.md)，业务工具契约见[能力与使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)。

## 运行环境与目录

发行包有 bundled 和 external 两种版本。bundled 使用包内私有 Node.js 22.23.4；external 要求同平台 Node.js >=22.14.0 且 <23、Node-API >=10。发行包运行不需要 pnpm，始终通过包内 `launch.sh`／`launch.ps1` 选择运行时；通用脚本使用 `run-node.sh`／`run-node.ps1`。

服务、MCP、SQLite 与资源管理共用一个 Node 进程。HTTP 仅监听 `127.0.0.1`，MCP 地址默认是 `http://127.0.0.1:43127/mcp`，传输方式为 Streamable HTTP，校验 Bearer、Host 和 Origin。

| 安装方式 | 数据目录 |
| --- | --- |
| 源码启动 | 默认 `.local/teamsight-mcp`，相对于启动工作目录 |
| 手动运行发行包 | 启动时通过 `--data-dir` 指定的绝对目录 |
| macOS Agent 安装 | `~/Library/Application Support/TeamSight MCP/data-mcp` |
| Windows 后台安装 | `%LOCALAPPDATA%\TeamSight MCP\data-mcp` |

数据目录包含 `teamsight.sqlite`、`access-token`、实例信息和分析文件等。当前数据库版本为 4，配置 schema 为 6；TAPD 凭据位于系统凭据库，服务名为 `TeamSight.MCP`。`access-token` 是宿主连接本机 MCP 的凭据，与 TAPD 个人令牌不同。

`TEAMSIGHT_DATA_DIR` 可指定默认数据目录，显式 `--data-dir` 优先。`TEAMSIGHT_UI_PATH` 用于开发时覆盖设置页 HTML。日常使用保持同一绝对数据路径，避免因切换工作目录而创建另一套配置。

## Codex 认证配置

macOS 自动安装器和 Windows 后台安装器会备份并配置 TeamSight 连接。手动运行发行包或源码服务时，在服务启动并生成 `access-token` 后，编辑 Codex 配置：默认 `~/.codex/config.toml`，设置了 `CODEX_HOME` 时使用该目录中的 `config.toml`。

桌面使用可采用静态请求头。先备份已有配置，再合并以下内容，仅在本机编辑器中将占位替换为数据目录 `access-token` 的实际值，保留其他 MCP 连接：

~~~toml
[mcp_servers.teamsight]
url = "http://127.0.0.1:43127/mcp"

[mcp_servers.teamsight.http_headers]
Authorization = "Bearer <本机访问令牌>"
~~~

配置文件及备份包含本机认证信息，应限制为当前用户可读写，不要将其提交或发到对话中。macOS 可对配置文件执行 `chmod 600`；Windows 使用当前用户文件权限保护。

若由你管理 Codex 的进程环境，也可改用以下配置，**替代**上述静态请求头：

~~~toml
[mcp_servers.teamsight]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_BEARER"
~~~

`TEAMSIGHT_BEARER` 的值必须与该数据目录的 `access-token` 一致，并传递到 **Codex 宿主进程**。在服务终端中设置环境变量，无法让已经运行的 Codex 桌面进程自动获得它。

修改后重新连接或重启 Codex，通过对话调用 `teamsight_status` 检查服务，再打开 `teamsight_open_settings`。TAPD 个人令牌在设置卡片中填写，不写进以上请求头。设置和交互式分析卡片需要宿主支持 MCP Apps。

## 服务管理

### 手动运行发行包

在解压后的包目录执行。以下沿用项目 README 的手动数据路径；如果你选择了其他目录，所有命令一并替换。

**macOS**

~~~sh
./launch.sh doctor
./launch.sh serve --data-dir "$HOME/Library/Application Support/TeamSight MCP/manual-data" --port 43127
~~~

在另一个终端进入相同包目录查询或停止：

~~~sh
./launch.sh status --data-dir "$HOME/Library/Application Support/TeamSight MCP/manual-data"
./launch.sh stop --data-dir "$HOME/Library/Application Support/TeamSight MCP/manual-data"
~~~

**Windows（PowerShell）**

~~~powershell
.\launch.ps1 doctor
.\launch.ps1 serve --data-dir "$env:LOCALAPPDATA\TeamSight MCP\manual-data" --port 43127
~~~

在另一个 PowerShell 中进入相同包目录查询或停止：

~~~powershell
.\launch.ps1 status --data-dir "$env:LOCALAPPDATA\TeamSight MCP\manual-data"
.\launch.ps1 stop --data-dir "$env:LOCALAPPDATA\TeamSight MCP\manual-data"
~~~

`serve` 在前台持续运行。`status` 与 `stop` 读取指定目录的实例信息及本机令牌，并核对服务身份；停止接口是经鉴权的 `POST /_internal/stop`。不要删除运行实例的锁或结束未知进程。

`doctor` 使用临时目录检查 SQLite、系统凭据库写入／读回／清理和 PNG 生成，可能触发系统授权提示。bundled 运行时缺失或损坏时直接失败，不回退系统 Node；external 从当前进程 PATH 查找兼容 Node。两种包均不安装全局 Node，不修改系统 PATH 或 nvm。

### macOS 后台安装

使用 [Agent 自动安装说明](../../docs/install/macos-agent-install.md)。该入口需要维护者先发布脚本与 macOS 资产，并完成匿名下载核验。安装器配置用户级 `cn.teamsight.mcp` LaunchAgent、Codex 认证、程序与日志目录；安装完成后重新连接宿主。

在安装器管理的安装中，使用同一份已校验脚本的 `--status` 查询、`--uninstall` 卸载。卸载保留数据、访问令牌、备份及系统凭据。手工维护的旧 LaunchAgent 继续按原方式管理，不能直接让安装器接管。

### Windows 后台安装

Windows 本地安装器要求 **PowerShell 7**，仅接受完整解压的 `win32-x64-bundled` 包，没有公网下载安装功能。管理脚本需在源码仓库另行构建，不是解压运行包后自动具备的命令。

先按下文完成源码依赖安装，再在仓库根目录构建管理脚本；将示例包路径替换为已经获取并校验的 bundled 包绝对路径：

~~~powershell
pnpm mcp:installer:windows:build
pwsh -NoProfile -File .local/windows-manager/install-windows.ps1 -Action Install -PackagePath 'C:\Downloads\TeamSight\teamsight-mcp-win32-x64-bundled'
~~~

安装器将程序复制到 `%LOCALAPPDATA%\TeamSight MCP\versions\0.3.4-bundled`，使用当前用户的隐藏登录计划任务运行，数据、日志和备份位于安装根目录下。无需管理员权限；关闭安装终端或切换 nvm 不影响后台服务。安装器自动备份并配置 Codex，完成后需重新连接宿主。

~~~powershell
pwsh -NoProfile -File "$env:LOCALAPPDATA\TeamSight MCP\install-windows.ps1" -Action Status
~~~

同入口支持 `Start`、`Stop`、`Uninstall`。Stop 同时禁用登录任务，Start 重新启用；卸载保留数据、凭据、日志与备份。安装前停止已知旧实例，避免端口冲突。沿用当前 PowerShell 执行策略，不通过降低策略绕过脚本限制。

## 升级与备份

从 0.3.3 或 0.3.4 升级到 0.3.5 沿用数据库 v4 和配置 v6，无需数据迁移。已有权限、日历选择、自定义字段和历史分析保留。

- **手动管理**：等待活动分析和待发送写入结束，安全停止旧实例并确认退出，备份静止数据目录与启动配置，再从新解压目录使用同一绝对 `--data-dir` 启动。保留旧包，不覆盖正在运行的目录。
- **macOS 安装器管理**：安装器支持从受管 0.3.3 升级及同版本包类型切换，进行校验、静止数据备份和失败恢复。按安装说明执行；遇到未知实例或手工改动的管理文件时停止处理。
- **Windows 安装器管理**：同版本重复安装使用管理状态核对；跨版本变更应先核对对应版本安装器能力，不能套用 macOS 自动升级流程。

升级后重新连接 MCP，并重新打开设置与分析卡片，加载当前版本的 `ui://teamsight/settings-0.3.5.html` 和 `ui://teamsight/analysis-0.3.5.html`。历史卡片不会自动更新。

恢复旧版本时先停止新版，恢复旧启动配置及其匹配的数据备份。数据目录备份不包含系统凭据库中的令牌；不要在升级时清除原凭据。

### 旧 MCP 数据离线迁移

仅旧 MCP 数据库 v3／配置 v5 需要显式迁移。先停止旧服务及其后台启动项并确认退出，然后在仓库根目录使用已构建的新 CLI：

~~~sh
node apps/server/dist/cli.js migrate --from /absolute/old-data --to /absolute/new-data
node apps/server/dist/cli.js serve --data-dir /absolute/new-data --port 43127
~~~

目标目录必须不存在，其父目录必须存在，且目标不能位于源目录内。源有实例锁时拒绝迁移；迁移过程中目标锁定，不能启动。源数据保持不变，旧 `TeamSight.P0` 凭据复制至 `TeamSight.MCP` 并校验。

迁移保留有效配置、revision、访问令牌、回执、缓存、作业和历史文件，移除旧请假豁免及旧项目名单字段。不提供 Tauri JSON 导入或启动时自动迁移。历史分析可只读查看与导出，旧规则结果不能用于新的容量计算或写入。

迁移失败不切换服务。若返回 `MIGRATION_CREDENTIAL_CLEANUP_REQUIRED`，保留锁定目标供人工处理，不启动该目录。回退使用原数据和原启动方式，不用新版数据覆盖旧目录。

## 源码开发与打包

使用 Node.js **22.23.4**、pnpm **10.12.4**，在仓库根目录执行：

~~~sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
node apps/server/dist/cli.js doctor
node apps/server/verify-mcp.mjs --evidence-dir artifacts/validation/mcp-local
~~~

`build` 和 `test` 覆盖全部 MCP 包。`verify-mcp` 使用真实 MCP 传输和隔离 TAPD，不写入业务 TAPD。源码服务的启动与管理命令：

~~~sh
pnpm mcp:serve --data-dir .local/teamsight-mcp --port 43127
~~~

另一终端在相同仓库根目录执行：

~~~sh
node apps/server/dist/cli.js status --data-dir .local/teamsight-mcp
node apps/server/dist/cli.js stop --data-dir .local/teamsight-mcp
~~~

| 目录 | 职责 |
| --- | --- |
| `apps/server` | MCP 服务、持久化、业务操作、报告与文件 |
| `apps/mcp-ui` | Vue 设置与分析卡片 |
| `packages/core` | 工时、风险、日历与排期计算 |
| `packages/tapd` | TAPD 客户端与接口契约 |

构建通过后选择目标生成发行包：

~~~sh
pnpm mcp:package darwin-arm64
# 或 pnpm mcp:package win32-x64
# 或 pnpm mcp:package all
~~~

每个平台生成 bundled／external 两种包，位于 `artifacts/releases/<版本>`。压缩包名含版本、平台与包类型，解压目录名不含版本。单平台附 `SHA256SUMS-<target>.txt`，all 附 `SHA256SUMS.txt`。已有目标拒绝覆盖；本地打包不更新本机服务、不上传发行资产，也不包含用户数据或 TAPD 凭据。macOS 正式发布流程见[首发手册](../../docs/install/github-macos-release.md)。

bundled 固定下载官方 Node 及校验哈希，缓存位于 `.local/node-runtime-cache`；只包含可执行文件和许可证，不含 npm。两种包都包含 `versions.json` 与 `checksums.json`。构建记录不代表目标平台已完成运行验收；Windows 原生依赖、可信缓存与验收命令见[平台说明](../../docs/validation/teamsight-mcp-platforms.md)。

macOS 安装说明由 `scripts/prepare-installer-release.mjs` 生成。修改说明时同步维护模板；只需更新本地说明时使用 `node scripts/prepare-installer-release.mjs --local-only`，不创建 Git 快照或发布资产。默认 prepare 会创建本地脚本快照，仍需维护者另行发布及验证。

## 故障排查

| 现象或代码 | 处理方式 |
| --- | --- |
| 宿主连接失败或认证失败 | 确认服务正在运行、端口一致、使用相同数据目录的 access-token；环境变量认证需确认宿主进程能读取；修改后重新连接 |
| CONFIG_REQUIRED | 按提示打开对应设置；缺 TAPD 令牌时在连接卡片中填写，随后继续原查询 |
| TEAM_SCOPE_REQUIRED | 配置默认分组成员，或在对话中明确指定人员／分组 |
| 节假日取数不完整 | 检查网络与日历设置，按需刷新对应年份；在数据完整前保留缺口解释 |
| Node 或原生模块检查失败 | 使用匹配系统及架构的包；external 检查版本、Node-API 和 PATH，bundled 重新核对包完整性 |
| 端口占用、未知锁或实例不匹配 | 用原管理方式核对并停止已知实例，不删除未知锁、不结束未知进程 |
| REVISION_CONFLICT | 重新读取设置或工作项，核对他人修改后再提交，避免覆盖旧快照 |
| STALE_PLAN | TAPD 来源已变化，重新分析并计算普通候选后再写入 |
| ANALYSIS_RULES_OUTDATED | 使用当前规则重新分析，历史快照继续只读保留 |
| 写入回执 unknown | 查询回执及远端对象，通过 tapd_verify_operation 核实；不换幂等键直接重发 |
| 模拟结果过期或服务重启 | calculationId 仅在当前进程缓存 30 分钟，重新读取并计算 |
| 升级后卡片或工具仍为旧版本 | 重新连接 MCP，重新打开卡片，再核对 teamsight_status |
| INSTALLER_LOCKED／ROLLBACK_REQUIRED | 核对是否仍有安装进程，保留安装器状态与备份，按错误处理后再恢复，不盲目清理锁 |

需要协助时提供操作系统、架构、版本、错误代码及已脱敏的检查结果，不发送令牌或完整配置。平台验收与已知边界见[平台文档](../../docs/validation/teamsight-mcp-platforms.md)。
