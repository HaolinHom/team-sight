# TeamSight MCP 本地服务 0.3.3

提供配置、身份与团队分组、TAPD 查询与受控写入、工时与风险、普通排期、紧急模拟、批量回执恢复、甘特图和报告。完整接口说明见[能力与使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)。

## 运行与打包

使用 Node.js 22.14+ 且低于 23、Node-API 10，pnpm 10.12.4。0.3.3 构建与自带运行时固定版本为 22.23.4。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
node apps/server/dist/cli.js doctor
node apps/server/verify-mcp.mjs --evidence-dir artifacts/validation/mcp-local
node apps/server/dist/cli.js serve --data-dir .local/teamsight-mcp --port 43127
node apps/server/dist/cli.js status --data-dir .local/teamsight-mcp
node apps/server/dist/cli.js stop --data-dir .local/teamsight-mcp
pnpm mcp:package darwin-arm64
pnpm mcp:package win32-x64
```

服务仅监听 127.0.0.1，`/mcp` 使用 Streamable HTTP，校验 Host、Origin 和 Bearer。管理停止接口为经过同样鉴权的 `POST /_internal/stop`。`instance.json` 记录本实例，`access-token` 为本机令牌。不要删除运行实例的锁或结束未知进程。

支持 `TEAMSIGHT_DATA_DIR` 和 `TEAMSIGHT_UI_PATH`（设置页 HTML 覆盖路径）；默认目录 `.local/teamsight-mcp`。数据库 `teamsight.sqlite`，user_version 4；配置 schemaVersion 6；系统钥匙串服务 `TeamSight.MCP`。凭据引用独立保存，正式设置表是唯一配置修订来源。

doctor 使用隔离数据验证 SQLite、系统钥匙串和 PNG；verify-mcp 使用真实 MCP 传输及隔离 TAPD，不向业务 TAPD 写入。自带版包含私有 Node，精简版不含 Node；两者均不含 TAPD 配置或令牌，已存在的输出目录拒绝覆盖。平台限制见[验收说明](../../docs/validation/teamsight-mcp-platforms.md)。

## 接入和设置

```toml
[mcp_servers.teamsight]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_BEARER"
```

环境变量须传递给宿主进程。重新连接后调用 teamsight_status、teamsight_open_settings；真实 TAPD 令牌在卡片中填写。保存令牌后自动同步项目与当前用户，新项目默认启用，身份发现不会扩大默认组。

设置目标为 overview、connection、projects、members、groups、hours、calendar、completed。局部保存通过 expectedRevision 校验，冲突保留草稿；writeAccess 子字段独立合并。读取和写入默认项目范围为启用且可访问项目，写入另须允许操作和字段，TAPD 实际权限仍然生效。

分析使用不可变 analysisId，保留来源时间与完整性；新计算统一 teamsight-mcp-hours-v3，不扣请假。缺预估按零处理但保留缺失标记，取数失败仍为未知。calculationId 仅当前进程有效、30 分钟到期；紧急模拟不可写入。批量 unknown 回执先核对，不换幂等键盲目重发。

## 从 0.2.6 离线迁移

必须先卸载对应 LaunchAgent／停止服务并确认退出，再显式执行：

```sh
node dist/cli.js migrate --from /absolute/old-data --to /absolute/new-data
node dist/cli.js serve --data-dir /absolute/new-data --port 43127
```

仅接受旧 MCP 数据库 user_version 3 / 配置 v5，目标目录必须不存在，不能位于源目录内。命令拒绝带实例锁的源；迁移期间目标被锁定，禁止启动。源数据保持不变，钥匙串凭据从 TeamSight.P0 复制到 TeamSight.MCP 并校验，日志不含明文。

迁移保留配置 revision、有效字段、访问令牌、回执、缓存、作业和历史文件，删除旧 exemptions 和两类旧项目名单。历史分析文件逐字节保留，可查看和导出；旧规则分析不可用于新计算或写入，须重新分析。旧钥匙串条目和源数据保留用于回退。

失败不会切换服务。通常目标和新凭据被清理；若返回 MIGRATION_CREDENTIAL_CLEANUP_REQUIRED，保留锁定目标以供处理，不启动它。回退时停止新版，恢复旧启动脚本并使用原数据目录；不要直接覆盖新版数据。

0.3.0 移除 Tauri、probe 工具、旧配置导入、tapd_list_workspaces 别名、p0/p1a/p1b 命令、旧环境变量及旧设置目标。当前 0.3.3 资源仅为 settings-0.3.3.html 与 analysis-0.3.3.html；旧卡片需要重新打开。历史版本知识、手册和报告不再作为当前操作指南。

## 0.3.1 甘特图修复

节假日及调休按分析快照日历绘制表头和整列底色，成员行的休息日零工时单元隐藏。工时块保留 .22／.30 两档底色，模式切换为 200ms 渐变。旧分析无日历明细时沿用普通周历。SVG／PNG／HTML 同步休息日底色。沿用数据库 v4、配置 v6，无需数据迁移；升级后重新打开分析卡片以加载新资源。

## 0.3.2 甘特图展示精简

顶部仅保留标题、日期范围和任务／工时优先按钮；底部仅保留完整性、来源时间及时区。图例、范围说明、日历及模拟提示不再展示，加载和错误反馈保留；详细依据仍通过对话查询。计算、详情与静态导出不变。沿用数据库 v4 和配置 v6，从 0.3.1 升级无需迁移；重新打开卡片加载新资源。

## 0.3.3 双版本发行

默认推荐 bundled 自带运行时版，包含私有 Node 22.23.4；external 精简版要求外部 Node 22.14+（低于23）、Node-API 10+。两种包业务文件和生产依赖相同，均无需安装 pnpm；自带版不安装全局 Node，不修改 PATH 或 nvm，启动时清除子进程 NODE_OPTIONS/NODE_PATH，并校验私有可执行文件 SHA-256。运行时缺失或损坏直接失败，不回退系统 Node。

源码开发使用 Node 22.23.4 / pnpm 10.12.4。先执行 pnpm build、pnpm test，再执行 pnpm mcp:package all；也可指定 darwin-arm64 或 win32-x64，每个目标均生成两种包。不传目标时选择本机平台。发行产物位于 artifacts/releases/0.3.3：macOS 为 tar.gz，Windows 为 zip，文件名包含版本、平台及 bundled/external；同目录保留解压目录与 SHA256SUMS.txt。单平台命令生成对应 SHA256SUMS-<target>.txt，既有产物拒绝覆盖。

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

0.3.2 → 0.3.3 沿用 DB v4、配置 v6，无需迁移。升级或切换两种包时先停止并确认旧实例退出，备份静止数据，再使用同一绝对 --data-dir 启动新包；不覆盖旧运行目录。MCP 资源更新为 settings-0.3.3.html 与 analysis-0.3.3.html，重新打开卡片。打包本身不更新本机服务、不上传发布，也不包含 TAPD 凭据或用户数据。
