# Windows x64 一键安装交接

Windows 本轮不构建、不发布 `.ps1` Pages 入口。后续在真实 Windows x64 环境实施，并与已发布的 macOS 站点合并部署，不覆盖或删除 macOS 入口。

- **入口和运行时**：在项目 Pages 路径增加 `install-mcp.ps1`、`install-mcp-external.ps1`，分别固定已校验的 Windows `.zip`、版本及 SHA-256。兼容系统 Windows PowerShell 5.1 的 `irm ... | iex`，验证 Pages 响应在 5.1 中可执行；不要求安装 PowerShell 7，不绕过企业策略。bundled 用归档内私有 Node，external 检查已有 x64 Node 22.14+、低于 23、Node-API 10+；固定实际执行路径，不改 PATH 或 nvm。
- **受管服务**：从现有 `scripts/install-windows.ps1` 复用 SID 与任务归属检查、用户级登录计划任务和 ACL，补齐 5.1 兼容、双包、数值版本比较、升级及回滚。未知服务不接管；升级保留数据库、配置、访问钥匙和 Credential Manager 凭据；本机更新则不降级。令牌文件和配置备份的 ACL 仅允许当前用户及系统管理账户访问。
- **Agent 契约**：沿用 macOS 的 `schema: 1`、`action`、`service: verified`、`url`、`credentialFile`、`codexHelper` 和 `instanceId`。安装器不改宿主配置或打印钥匙，配置助手另行调用且不覆盖非受管同名连接。
- **发布门槛**：先在普通用户的真实 PowerShell 5.1 中验证两条 `irm | iex`、新装／重复／换包／升级／回滚、退出及重新登录后的计划任务、ACL、路径含空格、无管理员时运行和 Codex 连接，再由同一 GitHub 仓库发布双包和脚本。错误或部分验收均不得发布 Windows 占位文件。
