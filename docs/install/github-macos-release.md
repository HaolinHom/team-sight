# GitHub Releases 与 Pages 首发手册

适用仓库：`HaolinHom/team-sight`。首发 `v0.3.5` 只发布 macOS arm64 bundled 和 external 两种包。Windows 参见[交接](windows-agent-handoff.md)。本手册中的命令是**验收对象**，不代表已发布或已验收。

## 初始化和首发

1. 由维护者审阅发布改动并合入 `main`。仓库管理员确认仓库允许 Actions，并将 `Settings → Pages → Build and deployment → Source` 设为 `GitHub Actions`；不要配置成从源码目录直接生成站点。若 `github-pages` Environment 有审批或分支限制，授权 `main` 并由相应维护者批准部署。
2. 打开 `Actions → Publish TeamSight MCP for macOS → Run workflow`，选择 `main`、`operation=publish`，首发留空 `rollback_run_id`。工作流在干净的 macOS arm64 runner 构建并验证双包，在构建提交创建标签和草稿 Release，上传并下载比对两个归档和 SHA-256 清单，再公开发布。版本来自应用包元数据；不得手工替换已公开的资产。
3. Release 匿名下载核对通过后才部署 Pages 首页和两个入口。`Verify public Pages` 成功表示匿名文件与构建产物一致，**不表示**已通过接收端或 Codex 验收。首页与 Release 说明在验收前不推广安装命令。

## 接收端验收

使用另一台 arm64 Mac 或新登录账号，确认无占用 `43127` 的服务及非受管同名 Codex 项，不使用 GitHub 登录凭据。先验收 bundled，再验收 external（事先确认已有 arm64 Node 22.14+、低于 23、Node-API 10+）。精简版也应使用独立的干净账号验证首次安装。

```sh
curl -fsSL https://haolinhom.github.io/team-sight/install-mcp | sh
curl -fsSL https://haolinhom.github.io/team-sight/install-mcp-external | sh
```

- 只对 `ok: true`、`schema: 1`、`service: verified` 的结果继续。退出码不是成功回执；Agent 执行时可启用管道失败传播。`already-current` 与 `newer-local` 使用返回的当前服务，不要强行覆盖。只运行已审阅的官方 HTTPS 入口；归档哈希不能替代对 Pages 发布者的信任。
- 确认安装阶段 `CODEX_HOME/config.toml` 字节未变且 stdout/stderr 没有钥匙正文。从结果读取 `codexHelper` 路径并作为单个可执行路径调用，不要 `eval` 输出。助手从 `credentialFile` 读取钥匙，不用终端变量或聊天传递。`CODEX_CONNECTION_CONFLICT` 意味着同名连接需要用户处理，不要覆盖；服务保持运行。
- 重新连接 Codex 后调用 `teamsight_status`，核对 `instanceId` 和版本。确认退出并重新登录后服务仍能启动；只进行健康验证，不发送 TAPD 写请求。其他宿主可用 `url`、`transport: streamable-http`、`auth: bearer` 和受保护的 `credentialFile`，宿主自行接入。
- 记录匿名下载哈希、两种包型、登录后服务验证、Codex 版本和结果。全部通过后，再在 README 与 Release 说明里把命令标为可用；记录本次发布的 Actions Run ID，供下次部署恢复。若接收端验收失败，先撤下首发入口（后续版本恢复上批），不要标为可用。

## 失败恢复

- Release 或 Pages 失败用 **Re-run failed jobs** 重试同一 Run，别启动新的完整构建来覆盖该版本。已上传的同名文件只有字节相同才允许继续；若已公开资产不符，停止并用新的发行版本发布修复。
- 后续版本填写当前已验收的发布 Run ID；部署前会核对线上入口和该次文件。如果 Pages 冒烟失败，工作流首发自动撤下入口，后续自动恢复上一批入口。必要时在 `main` 手动运行 `operation=restore` 加上此前通过 `Verify public Pages` 的发布 Run ID，或用 `operation=withdraw` 只保留停用首页。跨 Run 恢复需要未过期的发布产物（默认保留 90 天）；过期时先撤下入口，重新准备并验收新版本，不从不明来源恢复脚本。
- 本机遇到 `UNMANAGED_SERVICE`、`PORT_IN_USE` 或 `ROLLBACK_REQUIRED`，先检查现有服务和安装根目录 `~/Library/Application Support/TeamSight MCP` 内的备份。不要杀未知进程、删锁或清除数据；旧手动服务沿原启动方式维护。
