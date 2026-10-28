# TeamSight P0 服务原型

本目录只验证技术方案 v1.2 的 P0，不实现 TAPD 查询或写入，不读取旧 App 配置。正式业务工具留待后续阶段确认。

## 从源码运行

使用外部 Node.js **22.23.4**、pnpm **10.12.4**。兼容门槛为 Node.js 22.14.0+（<23）和 Node-API 10；其他 Node 主版本尚未纳入验收。

```sh
pnpm install --frozen-lockfile
pnpm p0:build
pnpm p0:test
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
[mcp_servers.teamsight_p0]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_P0_BEARER"
```

为 **Codex 进程**提供该变量，值从隔离数据目录的 `access-token` 读取。仅给当前终端设置环境变量，不能证明已经运行的桌面宿主拿到了变量。也可在本机配置中使用 `http_headers = { Authorization = "Bearer <本机测试令牌>" }`；不要将带令牌的配置提交进仓库。配置后按宿主要求重新连接 MCP，再在目标会话调用 `teamsight_status` 与 `teamsight_probe_open_settings`。

Apps 验证：读取修订 → 修改保存 → 新修订 → 重开；两张卡片以同一旧修订提交，第二张必须显示冲突；模拟失败必须保留输入与数据库原值；重启服务后重新连接并读取。凭据仅接受 `TEAMSIGHT_P0_SENTINEL_...` 测试值，写入系统凭据库，读取仅返回布尔状态。`visibility: ['app']` 只是展示元信息，不能视为保密或授权保证。

## 生成验证包

```sh
pnpm p0:build
pnpm p0:package darwin-arm64
pnpm p0:package win32-x64
```

输出到 `artifacts/releases/teamsight-p0-<目标>/`。包是普通 JS、生产依赖、`ui/index.html`、启动脚本、自动验证脚本、版本与校验清单，没有 Node 运行时，没有外部符号链接。Windows 原生 optional 包在打包时从 npm 获取并校验完整性；不要求安装者下载或编译。原目录存在时拒绝覆盖，重新打包前须保存或移走原产物。

包内执行 `node dist/cli.js doctor`、`node verify.mjs --evidence-dir ./evidence`、`node dist/cli.js serve --data-dir ./data --port 43127`，不执行 `pnpm install`。不生成未经宿主验收的 `.mcpb` 或 STDIO 包；当前交付以显式启动 HTTP 服务和 MCP 地址配置为路径。Bundle 直装、Codex Apps 真闭环和定时任务单列记录，不能用本脚本替代。

Windows 验收与接力提示词见 [交接文档](../../docs/validation/teamsight-p0-windows.md)。旧 Vue/Tauri 入口保留，根目录 `pnpm build` 与 `pnpm tauri build` 仍用于旧 App。
