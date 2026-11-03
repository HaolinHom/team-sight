# TeamSight MCP 本地服务

版本0.2.0，提供非敏感配置管理、令牌用户与成员范围、TAPD基础操作、需求／期间工作上下文、工时／容量、普通排期、紧急模拟、批量任务写入及双层甘特图。具体能力、参数示例及恢复流程见[能力与使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)。skills、Linux、DeepSeek Harness和旧App退役不在本轮范围内。

## 从源码运行

使用外部Node.js 22.14+且低于23、Node-API10，pnpm10.12.4。本轮macOS验证使用22.23.2；历史运行基线22.23.4。

~~~sh
pnpm install --frozen-lockfile
pnpm mcp:build
pnpm mcp:test
node apps/server/dist/cli.js doctor
node apps/server/verify-mcp.mjs --evidence-dir artifacts/validation/mcp-local
node apps/server/dist/cli.js serve --data-dir .local/teamsight-mcp --port 43127
~~~

doctor验证原生SQLite、系统凭据库和PNG渲染；verify-mcp使用真实MCP传输、原生存储和隔离TAPD接口，不写业务TAPD。旧verify.mjs、p0／p1a／p1b脚本和工具保留用于兼容。verify-p1b.mjs带execute-writes会写真实TAPD，不能当作普通离线验证运行。

~~~sh
node apps/server/dist/cli.js status --data-dir .local/teamsight-mcp
node apps/server/dist/cli.js stop --data-dir .local/teamsight-mcp
~~~

服务只监听127.0.0.1，/mcp使用Streamable HTTP，Host、Origin和Bearer均校验。数据目录的instance.json记录实例信息，access-token为本机MCP令牌，不能贴到对话。TAPD令牌存系统凭据库，SQLite仅保存引用。Apps通过宿主桥调用工具，不直连TAPD。

支持TEAMSIGHT_DATA_DIR、TEAMSIGHT_UI_PATH，并兼容原TEAMSIGHT_P0_*变量。未显式指定目录时仍使用原.local/teamsight-p0，避免隐藏已有配置。内部凭据库服务名和生命周期路径保留兼容；不应据此将新工具能力称为P0。不要结束未知进程或删除未确认实例的锁。

## Codex接入与配置

在宿主实际支持的MCP配置入口登记本机URL及访问令牌环境变量，例如：

~~~toml
[mcp_servers.teamsight]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_BEARER"
~~~

变量必须提供给Codex进程，值来自该实例access-token；仅给终端设置不证明桌面宿主拿到变量。配置后重新连接并调用teamsight_status、teamsight_open_settings。真实令牌在设置卡片填写，保存后自动同步项目和当前用户。项目全新同步默认启用；身份缓存不自动扩大默认团队。卡片支持多分组、测试人员组、默认组、排序、别名、日历和请假。

只读配置通过teamsight_get_config获取，修改非敏感设置用teamsight_update_config和expectedRevision。缺令牌返回CONFIG_REQUIRED和设置入口；初始化缺口明确返回，不自动代填凭据。Apps仅可见元信息不是权限或保密保证。旧资源URI settings-p1b.html、analysis-p1b.html保留。

## TAPD操作与恢复

tapd_list_operations／tapd_describe_operation公开白名单、参数契约、分页和文档；tapd_call_operation与专用工具共用校验，不接受任意URL、Header、删除或权限变更。完整账号是稳定身份，ID始终用字符串。读取范围受tapd.workspaceIds约束；写入还需在卡片设置tapd.writeAccess的项目、create/update操作和字段，自动项目同步不扩大写授权。

普通批量创建和补排期使用teamsight_write_tasks；日期修改需普通排期calculationId，新建需story_id，更新需id及expectedDigest。紧急结果只模拟，不能传给写入工具。回执在发送前保存批次关联，unknown先查teamsight_get_task_batch并只读核对，不换幂等键重发。部分成功不会自动删除或远端回滚；TAPD不提供跨任务事务和原子CAS。

## 分析与Apps

teamsight_analyze_hours、teamsight_start_analysis支持人员／分组／项目及业务日期。长查询返回jobId，可查询或取消；重启作业标记interrupted。analysisId引用不可变快照；calculationId引用当前进程临时模拟结果，30分钟或重启后失效。

新MCP工时规则将缺预估按0处理，保留缺失标记；取数失败仍未知。过去按实际，当天及未来按实际加剩余预计，包含当天不足。容量按规定工时、日历、请假、实际和其他预计扣减；旧App默认规则保留。数据不完整时不声称零工时或确定可行。

Apps提供任务／工时前后层切换、点击／悬浮／详情、完整范围筛选与模拟前后对比。背景无交互，不支持拖拽写入。静态png/svg/html与固定markdown/html/csv/json导出仍基于保存分析；它们不是业务周报模板。文件通过teamsight://artifacts资源或teamsight_read_artifact读取。模拟卡片不导出基线冒充模拟。

SQLite user_version保持3，业务配置v5；旧成员迁到默认组。回执、配置、作业、文件索引和缓存沿用现有表，不新增协作或计划表。未知写入回执不能为重试而清空。

## 运行包与验收

~~~sh
pnpm mcp:package darwin-arm64
pnpm mcp:package win32-x64
~~~

输出artifacts/releases/teamsight-mcp-目标，包含生产依赖、共享包源码／产物、全部Apps资源、离线验收脚本和校验清单，不含Node及TAPD配置。原p0:package转发到新打包器，已有输出目录拒绝覆盖。Windows optional native依赖在构建时从npm下载并校验完整性。

包内运行node dist/cli.js doctor和node verify-mcp.mjs。使用及真实Codex／Windows验收步骤见[平台说明](../../docs/validation/teamsight-mcp-platforms.md)。自动测试、浏览器SDK宿主、真实Codex卡片和Windows实机分别验收。隔离浏览器宿主为test/preview-mcp.mjs（端口43129、虚构数据、不发布），原test/preview-p1b.mjs仅保留旧验收兼容。

旧Vue/Tauri入口保留，根pnpm test与pnpm build继续用于旧App回归。此前P1b真实写入证据见[历史报告](../../artifacts/report/20261028_teamsight-p1b_测试报告.md)，不能作为新增批量逻辑的真实远端验收。
