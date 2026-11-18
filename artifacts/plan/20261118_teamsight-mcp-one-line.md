# TeamSight MCP 一键安装与 GitHub 首发方案

## Summary

交付 macOS arm64 发行版与精简版的一键安装、Codex 接续配置和端到端验收。继续使用公开仓库 `HaolinHom/team-sight`；本轮启用 Pages、首发 `v0.3.5` 并部署两个入口。Windows 仅留实施指引。

## Implementation Plan

- 维护者审阅后合入 `main`；仓库管理员启用 Actions 并将 Pages 发布源设为 GitHub Actions。手动发布工作流从 `main` 构建并验证双包，限定构建、Release 和 Pages 作业各自所需权限。
- 在构建提交建立 `v0.3.5` 标签和草稿 Release，上传双包、SHA-256 清单及说明，经校验后公开发布。匿名核对归档，再将 `install-mcp` 和 `install-mcp-external` 连同首页部署到 `haolinhom.github.io/team-sight/`。不覆盖已发布资产；失败重试同批产物；首发冒烟失败撤下入口，后续发版可恢复上批验收产物。验收后才在 README 和 Release 说明标为可用。
- 新入口识别 macOS arm64；bundled 用私有 Node，external 检查已有兼容 Node。对受管安装按数字版本处理：首次安装、旧版升级、同版本同包型验证后不下载归档、同版换包、本机更新则不降级。未知服务冲突不接管。
- 先校验归档、清单、运行时，再切换 LaunchAgent；活动作业或待发送写入阻止切换，保留数据库、设置、钥匙和 TAPD 凭据，失败恢复旧服务。保持旧手动安装方式。
- 安装只启服务并验证 MCP，输出成功状态、回环地址、钥匙文件路径、配置助手路径，不输出钥匙值。Agent 单独运行助手配置 Codex：尊重 `CODEX_HOME`、备份配置、不改无关条目、不覆盖非受管同名连接；用 `teamsight_status` 核对实例。其他宿主只给通用 Streamable HTTP 指引。
- Windows x64 交接沿用 GitHub 分发和连接契约；后续真实 Windows PowerShell 5.1 环境验证 `irm | iex`、计划任务、ACL、双包和升级回滚后再发布两个 `.ps1` 入口。

## Test Plan

覆盖双包首次安装、重复、切换、升级、不降级、Node 不兼容、下载截断、哈希错误、未知服务冲突及回滚。使用匿名接收端执行两个正式命令，验证重新登录、钥匙不泄露、安装不改 Codex 配置及实际 Codex 连接。不切换现有生产 MCP，不进行真实 TAPD 写入。

## Assumptions

首发需要受审发布提交及有权限的 GitHub 账号；缺失时明确报告阻塞，不把本地测试记为线上验收。
