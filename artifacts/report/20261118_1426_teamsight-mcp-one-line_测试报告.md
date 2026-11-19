# TeamSight MCP 0.3.5 一键安装测试报告

## Summary

在本机 macOS arm64 的隔离目录、回环 HTTPS、独立 LaunchAgent 标签及独立 `CODEX_HOME` 验证 `0.3.5`。本机生产 MCP 未切换；未执行真实 TAPD 写入。

## Results

- `pnpm mcp:build` 与 `pnpm mcp:test` 通过，共 170 项回归。macOS 双包通过归档和包内完整性、SQLite、Keychain、PNG、原生进程启动/状态/停止和 MCP 检查；bundled 使用 Node 22.23.4，包验证中的 external 使用 22.23.2。
- 启动脚本端到端 26 个场景通过。包括本地 HTTPS 下的脚本截断、归档截断和哈希错误拒绝；无系统 Node 安装发行版；精简版缺失或不兼容 Node；两包首次安装、同包重复及不降级均不重复下载、换包、冲突拒绝；受管 0.3.4 失败回滚及成功升级保留配置、设置 revision 和本机钥匙。旧固定安装器行为也通过回归。
- 安装不修改 Codex 配置。配置助手保留无关配置，不覆盖非受管同名条目，重复运行保持原字节。隔离 Codex CLI 0.156.0 的 app-server 对两个包型分别真实调用 `teamsight_status`，实例 ID 和版本一致，未启用生产配置或原生 UI。
- GitHub 工作流通过 `actionlint`；两份 Pages 脚本和 Release Bash 脚本通过语法检查；旧安装器生成一致性及 `git diff --check` 通过。

## Issues

- 初轮包验收将外部 Node 错误限制为内置 Node 版本；已改为核对实际外部 Node，重新验证通过。初轮配置助手重复执行会改写 TOML 但语义不变；已按解析结果判断变更，重新验证通过。
- GitHub 管理 API 只读确认 Actions 已启用且 Pages 发布源为工作流。发布工作流尚未经维护者审阅并合入 `main`；该分支上的工作流、`v0.3.5` Release 和两个公开入口均返回 404。没有推送或绕过审核发布。

## Not Tested

正式 GitHub Actions runner 构建、草稿/公开 Release、公开资产匿名哈希核验、Pages 正式部署与恢复、独立接收端和退出/重新登录验收均未执行。未验收 Windows 或 Codex 原生 Apps 卡片。本地归档只用于测试，不上传为正式发行资产。

## Artifacts

- 方案：`artifacts/plan/20261118_teamsight-mcp-one-line.md`。
- 证据：`artifacts/report/evidence/20261118-mcp035/final.log`、`package-acceptance.json`、`install/acceptance.json`。
- 发布与恢复操作：`docs/install/github-macos-release.md`。
