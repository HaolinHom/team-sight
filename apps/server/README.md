# TeamSight MCP 本地服务 0.3.0

提供配置、身份与团队分组、TAPD 查询与受控写入、工时与风险、普通排期、紧急模拟、批量回执恢复、甘特图和报告。完整接口说明见[能力与使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)。

## 运行与打包

使用 Node.js 22.14+ 且低于 23、Node-API 10，pnpm 10.12.4。本机验证版本为 22.23.2。

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

doctor 使用隔离数据验证 SQLite、系统钥匙串和 PNG；verify-mcp 使用真实 MCP 传输及隔离 TAPD，不向业务 TAPD 写入。运行包不含 Node、TAPD 配置或令牌，已存在的输出目录拒绝覆盖。平台限制见[验收说明](../../docs/validation/teamsight-mcp-platforms.md)。

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

0.3.0 移除 Tauri、probe 工具、旧配置导入、tapd_list_workspaces 别名、p0/p1a/p1b 命令、旧环境变量及旧设置目标。资源仅为 settings-0.3.0.html 与 analysis-0.3.0.html；旧卡片需要重新打开。历史版本知识、手册和报告不再作为当前操作指南。
