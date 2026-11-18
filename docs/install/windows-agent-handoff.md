# Windows x64 一键安装与验收

适用版本：`0.3.5`。Windows 一键入口与 macOS 入口由同一工作流生成和部署；公开命令在 Release 和接收端验收前不可用。发布步骤见[首发手册](github-macos-release.md)。

## 安装行为

- 使用普通用户的 64 位 Windows PowerShell 5.1，不安装 PowerShell 7、不调整执行策略。两条 `irm | iex` 入口各自固定 Windows ZIP、版本和 SHA-256；自带版使用包内 Node，精简版固定已有的 x64 Node 22.14+、低于 23、Node-API 10+ 的实际路径，不修改 PATH 或 nvm。
- 受管根目录是 `%LOCALAPPDATA%\TeamSight MCP`，服务通过当前用户的登录计划任务运行。已核验的 `0.3.3`／`0.3.4` 受管版本可升级；同版本同包型及本机较新时不下载。切换包型仍使用同一 `data-mcp` 和端口。安装时不访问 Codex 配置，失败恢复原受管任务和状态，不清理未知实例。若提示 `ROLLBACK_REQUIRED`，保留 `backups`，由维护者核对任务与实例后处理；不要删锁或杀未知进程。
- 成功回执为 `ok: true`、`schema: 1`、`service: verified`。随后才使用 `& $receipt.codexHelper` 按有效 `CODEX_HOME` 配置 Codex，遇到同名非受管项时保持原样。重新连接后调用 `teamsight_status`，核对版本及 `instanceId`。不要读取或传递钥匙文件正文。

## 本机验收

先构建双包和旧版管理器（仅供升级夹具使用），再运行隔离 HTTPS 验收。将命令中的证据输出目录和 legacy 双包目录换为本机实际路径：

```powershell
pnpm install --frozen-lockfile
pnpm mcp:build
pnpm mcp:package win32-x64
pnpm mcp:installer:windows:build
pnpm mcp:installer:windows:pages artifacts/releases/0.3.5 .local/windows-pages 0.3.5
$env:TEAMSIGHT_TEST_CODEX = (Get-Command codex.exe).Source
pnpm mcp:installer:windows:verify-pages artifacts/releases/0.3.5 .local/windows-evidence 0.3.5 artifacts/releases/0.3.3 artifacts/releases/0.3.4
```

验收脚本还接受 `TEAMSIGHT_TEST_OLD_NODE`（不兼容 `node.exe` 所在目录）及 `TEAMSIGHT_TEST_OPENSSL`（若 Git for Windows 未提供 OpenSSL）。隔离脚本只信任本次临时 HTTPS 证书，不修改系统信任或执行策略，完成后停止测试服务并注销测试任务。真实重新登录须在独立测试账户中验证并单独记录，不用手动启动任务替代；公网交付检查在合并并发布后进行。
