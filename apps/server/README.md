# TeamSight P1b 本地服务

本目录实现技术方案 v1.2 的 P1b：需求/任务基础读写、操作目录、共享排期/工时分析、可解释风险、MCP Apps 和静态报告。MCP、业务、SQLite 与资源共用一个本机服务进程，保留 P0/P1a 兼容入口。当前停在 P1b 验收点，P1c 的发行、Windows 实机、宿主定时和旧 App 退役尚未实施。

## 从源码运行

使用外部 Node.js **22.23.4**、pnpm **10.12.4**。兼容门槛为 Node.js 22.14.0+（<23）和 Node-API 10；其他 Node 主版本尚未纳入验收。

```sh
pnpm install --frozen-lockfile
pnpm p1b:build
pnpm p1b:test
node apps/server/verify.mjs --evidence-dir artifacts/validation/p0-local
node apps/server/dist/cli.js serve --data-dir .local/teamsight-p0 --port 43127
```

`verify.mjs` 创建临时目录和测试凭据，通过两个 MCP 客户端验证共享进程、资源、配置修订、失败回滚、图像和进程重启，然后清理测试凭据与目录。`doctor` 单独验证三个原生模块。两个入口均不证明目标 Codex Apps 或宿主定时验收通过。

```sh
node apps/server/dist/cli.js doctor
node apps/server/dist/cli.js status --data-dir .local/teamsight-p0
node apps/server/dist/cli.js stop --data-dir .local/teamsight-p0
```

服务只监听 `127.0.0.1`，`/mcp` 为 Streamable HTTP。`/health` 和 `/_p0/stop` 是需要同一身份校验的生命周期诊断入口。拒绝未知 Host、Origin、缺失或错误 Bearer；无 Origin 的本机 MCP 客户端可连接。Apps 不直接访问 HTTP，所有调用经宿主桥接。

数据目录内 `access-token` 为本地 MCP 身份；`instance.json` 提供 URL、PID、实例 ID 和令牌文件路径。令牌不等同于 TAPD 凭据，不要贴到对话或公开日志。异常退出留下锁文件时，先核对实例 PID、进程命令和健康检查；确认原进程已退出后才移除该隔离目录中的 `instance.lock`，不能结束未知进程。

## 连接 Codex

在 Codex 的 MCP 配置中登记服务（配置文件为 `~/.codex/config.toml`，通过宿主实际支持的入口编辑）：

```toml
[mcp_servers.teamsight_p1b]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_P1B_BEARER"
```

为 **Codex 进程**提供该变量，值从隔离数据目录的 `access-token` 读取。仅给当前终端设置环境变量，不能证明已经运行的桌面宿主拿到了变量。也可在本机配置中使用 `http_headers = { Authorization = "Bearer <本机测试令牌>" }`；不要将带令牌的配置提交进仓库。配置后按宿主要求重新连接 MCP，再在目标会话调用 `teamsight_status` 与 `teamsight_open_settings`。P0 的 `teamsight_probe_*` 工具仍保留用于旧验收记录。

Apps 设置：读取设置修订 → 修改项目/成员/TAPD 连接、工时与小时请假、中国日历及写入范围 → 保存 → 重新读取。旧 JSON 导入时凭据字段被忽略；查询与写入均在服务端执行，UI 不直连 TAPD。Token 写入系统凭据库，读取仅返回是否存在；`visibility: ['app']` 只是展示元信息，不能视为保密或授权保证。设置与分析资源分别为 `ui://teamsight/settings-p1b.html`、`ui://teamsight/analysis-p1b.html`，随构建自包含交付。

## TAPD 读取与写入

先调用 `tapd_list_workspaces` 和 `tapd_get_workspace_schema` 获取项目、精确成员账号、字段与状态。`tapd_search_items`、`tapd_get_item` 支持 `story/task/bug`；仅需求和任务支持写入。ID 始终使用字符串。`tapd_list_operations`、`tapd_describe_operation` 公开固定方法、编码、参数、分页及文档依据；`tapd_call_operation` 使用同一参数契约和权限校验，不接受任意 URL、Header、删除或权限变更。

读取范围由 `tapd.workspaceIds` 限定，未填写时采用配置项目。写入还必须显式设置 `tapd.writeAccess` 的项目、`create/update` 操作及字段，迁移默认禁用写入。例如：

```json
{
  "tapd": {
    "writeAccess": {
      "workspaceIds": ["62119705"],
      "operations": ["create", "update"],
      "fields": ["name", "description", "owner", "begin", "due", "effort", "status", "story_id"]
    }
  }
}
```

通过 `teamsight_save_settings` 的 `patch` 提交并携带当前 `expectedRevision`。允许字段仍受具体对象元数据限制。`owner` 要求项目成员目录中的完整账号，多人以 `;` 分隔；仅名称或工号会返回候选，不能静默选人。任务状态使用 TAPD 文档的 `open/progressing/done`，需求状态从项目元数据读取。

`tapd_create_item` 需要 `workspaceId`、`entityType`、`fields`、稳定的 `idempotencyKey` 和 `actor`；创建时必须有标题，使用远端初始状态。修改先 `tapd_get_item`，再向 `tapd_update_item` 传入 `id`、`expectedDigest` 及同样的写入参数。通用目录的 `task.create` 等操作由 `operationId` 决定对象类型，`parameters` 不再包含 `entityType`。

写入使用 POST 表单、持久回执及读回核对；不自动重试。相同幂等键复用回执，参数不同返回 `IDEMPOTENCY_KEY_CONFLICT`。`tapd_get_operation` 读取状态；`unknown` 时使用 `tapd_verify_operation` 只读核对，远端 ID 不明时先搜索标记对象，再提供 `candidateId`。服务重启把已发在途写入转为 `unknown`，不能据此重新创建对象。本地幂等不保证 TAPD 远端恰好一次，字段摘要也不是原子 CAS。服务只保存字段哈希，不在回执中记录敏感正文。

## 分析、Apps 与文件

`teamsight_analyze_hours` 输入 `start/end`，可显式指定 `analysisDate`、项目、成员和 `refresh`。服务按业务时区确定分析日，超过两秒返回 `jobId`；用 `teamsight_get_job` 查询，或 `teamsight_cancel_job` 取消读取。`teamsight_start_analysis` 可直接创建作业。重启后的运行作业标记 `interrupted`，需重新开始分析。

得到 `analysisId` 后，在 `teamsight_open_analysis`、`teamsight_read_analysis`、`teamsight_check_risks`、`teamsight_render_gantt` 和 `teamsight_generate_report` 中复用该 ID。Apps 提供日期、成员、甘特、每日贡献明细、风险依据和工作项链接；分页及截断均有提示，完整事实可通过 JSON 导出读取。导出使用完整分析范围。

每日实际与未结束工作项累计花费独立读取；保留成员顺序、项目别名、小时请假扣减及中国节假日/调休。需求不参与 task/bug 工时汇总。覆盖只包含配置成员，未扫描无负责人对象；当前未结束日仅报告进度。`partial/failed` 和未知量必须连同结论呈现，不能解释成零工时或无风险。中国日历按年度持久缓存并使用固定双源，`teamsight_refresh_calendar` 可手动刷新；缺源时标出限制并抑制确定的不足结论。

完整取数缓存为 60 秒，命中保留原始来源时间；规则/别名变化可重新计算并复用原快照。写入使缓存失效，已保存分析和报告保持不可变。所有 TAPD 请求共享并发上限 3，读取有界重试，完整分页上限为每页 200、50 页；count 不一致、重复页或截断会降为部分数据。

甘特支持 `png/svg/html`，固定报告支持 `markdown/html/csv/json`。静态甘特按 30 天、30 个实际成员任务行分页，上限 200 页并检查像素预算；超预算会报错，应缩小分析范围。HTML/SVG 转义外部文本，CSV 防止公式注入。产物返回 MIME、大小、SHA-256、分析/快照 ID 和 `teamsight://artifacts/{id}` 资源引用；`teamsight_read_artifact` 支持分段文本及 PNG 图片，宿主无需访问本机文件路径。

SQLite schema v3 保存配置、缓存索引、操作回执、作业和文件元信息；快照/分析/产物保存在数据目录 `files/`，文件权限 0600。数据目录是服务持久状态，保留未完成及未知操作回执，不能为重试而清空。

## P1b 验证边界

指定项目 `62119705` 的需求与任务各一次创建、修改及读回验证已通过，证据见 [P1b 报告](../../artifacts/report/20261028_teamsight-p1b_测试报告.md)。验收对象和隔离目录 `.local/teamsight-p1b-live` 保留，服务使用端口 `43129`，未改写已有 Codex MCP 配置。`verify-p1b.mjs --workspace 62119705 --execute-writes` 是明确执行真实写入的专项脚本；现有回执会复用，不能删除目录后随意重跑。

`test/preview-p1b.mjs` 与 `apps/mcp-ui/test` 仅供官方 AppBridge 浏览器验证，不在生产构建或发布包中。浏览器检查不证明 Codex 原生卡片通过。当前原生界面工具禁止操作 Codex，仍需人工验证卡片打开、筛选、明细和导出；Windows、宿主定时及首版发行属于 P1c。

## P0 验证包（保留入口）

以下仍生成历史 P0 验证包，不作为 P1b 发行物；P1c 再固定首版依赖、全部 Apps 资源及两系统交付。

```sh
pnpm p0:build
pnpm p0:package darwin-arm64
pnpm p0:package win32-x64
```

输出到 `artifacts/releases/teamsight-p0-<目标>/`。包是普通 JS、生产依赖、`ui/index.html`、启动脚本、自动验证脚本、版本与校验清单，没有 Node 运行时，没有外部符号链接。Windows 原生 optional 包在打包时从 npm 获取并校验完整性；不要求安装者下载或编译。原目录存在时拒绝覆盖，重新打包前须保存或移走原产物。

包内执行 `node dist/cli.js doctor`、`node verify.mjs --evidence-dir ./evidence`、`node dist/cli.js serve --data-dir ./data --port 43127`，不执行 `pnpm install`。不生成未经宿主验收的 `.mcpb` 或 STDIO 包；当前交付以显式启动 HTTP 服务和 MCP 地址配置为路径。Bundle 直装、Codex Apps 真闭环和定时任务单列记录，不能用本脚本替代。

Windows 验收与接力提示词见 [交接文档](../../docs/validation/teamsight-p0-windows.md)。旧 Vue/Tauri 入口保留，根目录 `pnpm build` 与 `pnpm tauri build` 仍用于旧 App。
