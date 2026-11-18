# TeamSight MCP 平台与 Codex 验收

当前版本 0.3.4。目标为 macOS arm64、Windows x64；Windows 实机、其他平台和 Codex 原生 Apps 需对应环境单独验收。

## Windows 实机验收与本地后台安装

Windows 源码开发支持 nvm-windows：`nvm install 22.23.4 64`、`nvm use 22.23.4`，再安装 pnpm 10.12.4 并按锁文件安装。已有 22.13.x 不满足最低 22.14 要求。下载如需代理，使用本机有效代理；不关闭 TLS 校验，发行 Node 仍须匹配固定 SHA-256。

仅构建 Windows 后运行：

```powershell
$env:TEAMSIGHT_TEST_OLD_NODE = "$env:NVM_HOME/v16.20.2" # 已安装的不兼容版本目录，用于错误诊断验证
node scripts/verify-mcp-packages.mjs artifacts/releases/0.3.4 artifacts/validation/windows/packages win32-x64
pnpm mcp:installer:windows:build
pwsh -NoProfile -File .local/windows-manager/install-windows.ps1 -Action Install -PackagePath "$PWD/artifacts/releases/0.3.4/teamsight-mcp-win32-x64-bundled"
```

验收脚本优先使用已安装的 PowerShell 7，也可通过 `TEAMSIGHT_POWERSHELL` 指定绝对路径；未安装时使用 Windows PowerShell。沿用该宿主现有执行策略，禁止脚本时直接失败，不传 ExecutionPolicy 绕过。验收解压目录包含中文与空格，验证原生模块、MCP、双版本共享数据、参数和退出码，以及运行时缺失、损坏、不兼容诊断。`acceptance.json` 单独记录真实运行结果，不改封存包。

Windows 本地安装器要求 PowerShell 7，消费已解压 bundled 包，不提供公网下载。默认根为 `%LOCALAPPDATA%\TeamSight MCP`，程序 `versions/0.3.4-bundled`，数据 `data-mcp`，日志 `logs`，备份 `backups`。用当前用户 SID 创建非管理员隐藏登录计划任务，固定安装时 PowerShell 绝对路径和包内 Node；不受 nvm 后续切换影响。默认端口 43127；可通过 `-InstallRoot`、`-CodexHome`、`-Port` 做隔离验收。

安装后的 `install-windows.ps1 -Action Status|Start|Stop|Uninstall` 管理服务。Stop 同时禁用登录任务，Start 重新启用；重复 Install 校验既有安装并确保启动。安装器校验文件集合/哈希、任务身份、进程、实例身份；拒绝未知端口、锁及被改动的管理文件。Codex 配置使用静态 Authorization，复用 TOML 结构编辑，保留其他连接和审批策略；令牌、数据与配置备份以当前用户、SYSTEM、Administrators ACL 保护，不输出令牌。卸载移除匹配连接、任务及版本程序，保留数据、凭据、日志、备份及管理入口。

真实登录/重启和 Codex 原生卡片须另行验收；后台任务重启与独立 MCP 客户端通过不等于宿主已经重连。

## 双版本发行

默认推荐 bundled 自带运行时版，包含私有 Node 22.23.4；external 精简版要求外部 Node 22.14+（低于23）、Node-API 10+。两种包业务文件和生产依赖相同，均无需安装 pnpm；自带版不安装全局 Node，不修改 PATH 或 nvm，启动时清除子进程 NODE_OPTIONS/NODE_PATH，并校验私有可执行文件 SHA-256。运行时缺失或损坏直接失败，不回退系统 Node。

源码开发使用 Node 22.23.4 / pnpm 10.12.4。先执行 pnpm build、pnpm test，再执行 pnpm mcp:package all；也可指定 darwin-arm64 或 win32-x64，每个目标均生成两种包。不传目标时选择本机平台。发行产物位于 artifacts/releases/0.3.4：macOS 为 tar.gz，Windows 为 zip，文件名包含版本、平台及 bundled/external；同目录保留解压目录与 SHA256SUMS.txt。单平台命令生成对应 SHA256SUMS-<target>.txt，既有产物拒绝覆盖。

Node 官方归档固定版本与 SHA-256，缓存位于 .local/node-runtime-cache；复用仍校验，缓存损坏须删除对应缓存后重试。Windows 原生依赖沿用 TEAMSIGHT_MCP_NATIVE_CACHE 的可信缓存校验。打包使用 bsdtar（macOS、Windows 自带 tar）处理 ZIP/tar.gz；只附带 Node 可执行文件及其 LICENSE，不附带 npm 或开发头文件。

解压后在包目录使用以下命令；路径允许包含空格：

~~~sh
# macOS，两种包使用相同命令
./launch.sh doctor
./run-node.sh verify-mcp.mjs --evidence-dir ./evidence
./launch.sh serve --data-dir /absolute/team-sight-data --port 43127
# 另一终端
./launch.sh status --data-dir /absolute/team-sight-data
./launch.sh stop --data-dir /absolute/team-sight-data
# 宿主定时调用辅助脚本
./run-node.sh status-mcp.mjs /absolute/team-sight-data
~~~

~~~powershell
# Windows，两种包使用相同命令
.\launch.ps1 doctor
.\run-node.ps1 verify-mcp.mjs --evidence-dir .\evidence
.\launch.ps1 serve --data-dir 'C:\TeamSight Data' --port 43127
.\launch.ps1 status --data-dir 'C:\TeamSight Data'
.\launch.ps1 stop --data-dir 'C:\TeamSight Data'
.\run-node.ps1 status-mcp.mjs 'C:\TeamSight Data'
~~~

使用现有 PowerShell 执行策略，不自动降低策略。系统 Node 缺失或不兼容时请选择自带版。不要通过系统 node 或 npm start 绕过包内启动入口。

每包 versions.json 区分 variant/runtimeBundled、buildNode 和 validatedNode；打包时 validatedNode 为 null，验收结果保存在独立证据中，不修改已封装的包。自带版记录 Node 来源、归档与可执行文件哈希；checksums.json 覆盖包内全部文件（不包括自身），归档另有 SHA-256 清单。Windows 结构/PE 校验不代表 Windows 实机或原生 Apps 验收通过。

0.3.3 → 0.3.4 沿用 DB v4、配置 v6，无需迁移。升级或切换两种包时先停止并确认旧实例退出，备份静止数据，再使用同一绝对 --data-dir 启动新包；不覆盖旧运行目录。MCP 资源更新为 settings-0.3.4.html 与 analysis-0.3.4.html，重新打开卡片。打包本身不更新本机服务、不上传发布，也不包含 TAPD 凭据或用户数据。

## macOS 自动安装

独立 HTTP 安装器与可复制给 Agent 的说明见[安装入口](../install/macos-agent-install.md)。使用固定提交和归档 SHA-256；仅支持 macOS arm64，默认 bundled，也支持 external。安装器配置用户级 LaunchAgent，并自动将本机 Bearer 写入仅当前用户可读的 Codex http_headers.Authorization，不依赖终端环境变量。服务验证与 Codex 宿主重连分别报告。

维护者使用 pnpm mcp:installer:build、pnpm mcp:installer:verify、pnpm mcp:installer:prepare 构建、隔离验收及生成固定快照说明。隔离验证使用 --test-root（必须为 teamsight-installer-test- 前缀）、独立标签和配置；可选 --test-base-url 只允许 localhost/127.0.0.1 的 HTTPS，要求 --test-ca，不能用于绕过生产地址或固定哈希。仓库公开前只验证隔离下载源，公开匿名下载与接收端宿主仍需独立验收。

## Codex 接入

通过宿主 MCP URL 配置入口连接 http://127.0.0.1:43127/mcp，访问令牌使用数据目录 access-token 对应的本机环境变量；不要将它或 TAPD 令牌贴入对话。不是将 ZIP 改名为 Bundle 安装。配置前保留宿主既有其他连接。

分别实测：

1. 工具发现、teamsight_status，多对话同一进程。
2. 未配置TAPD的业务请求引导 teamsight_open_settings(target:connection,continueRead:true)；在真实卡片填写令牌，保存后项目全部启用、当前用户准确。重新同步保留别名、颜色和排序。
3. 定向项目／成员等配置只展示目标表单，普通设置展示分类入口；保存、重开、两卡片修订冲突、失败后草稿、服务重启与凭据读取。新成员只保存身份，多分组且仅一个默认组。
4. 原生分析卡片任务优先/工时优先切换，背景无点击、悬浮和焦点，前景详情；卡片没有成员/项目/日期筛选入口，操作区只保留模式切换，范围通过对话指定。无排期有花费仍可查看。
5. 通过对话查看普通候选、倒排和紧急模拟前后结果，卡片不提供候选／基线切换控件。模拟使用进程内缓存30分钟，重启/过期后重新计算；模拟无写入。
6. 在专用验证项目检查普通批量创建、补排期、重复请求和读回。未知操作先查回执和核对，不换键重发。
7. 记录操作系统/架构/Node/Codex版本、包清单、日志、截图和结果。Windows需在真实Windows上完成同样步骤；macOS结果不代替Windows。

## 已知能力边界

需求正文、正文图片/链接、附件元数据、需求及任务历史均通过登记接口读取。附件下载链接按需获取（默认约300秒有效），服务不自动下载文件。接口无权限、分页不完整或关联筛选异常时明确返回缺口。缺陷历史尚未接入期间活动聚合，不能把当前状态等同于期间完整状态变化。报告模板与风险方法留skills。既有分析和技术导出保留，不等同于业务周报。
