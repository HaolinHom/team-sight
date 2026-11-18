# TeamSight Windows x64 一键安装测试报告

## Summary

本机为 Windows 10 x64、非管理员、Windows PowerShell 5.1.19041.6093（原策略 `Restricted`）。安装候选为 0.3.5，使用 Node 22.23.4、Node-API 10、pnpm 10.12.4 和 Codex CLI 0.137.0。HTTPS、计划任务、端口、存储和 `CODEX_HOME` 全部隔离；未切换本机已有的 TeamSight 0.3.3，真实 TAPD 写请求为零。

## Results

| 验收 | 结果 |
| --- | --- |
| 构建及回归 | `pnpm mcp:build`、`pnpm mcp:test` 通过；新增清单固定校验后，脚本回归 20 项通过，2 项 macOS/POSIX 专属跳过。密钥扫描通过。 |
| 双包原生验收 | `mcp:package:verify` 核对两个 ZIP、PE x64、文件清单、运行时隔离、SQLite、Credential Manager、中文 PNG、共享数据及 39 项 MCP 工具，均通过。 |
| 两条 5.1 HTTPS 入口 | 真实 `irm \| iex`；测试响应覆盖 `text/plain` 和 `application/octet-stream`。截断脚本、截断或篡改 ZIP 不产生成功回执；空 PATH 的 bundled 安装、external 首装、缺失或不兼容 Node 拒绝通过。 |
| 安装生命周期 | 15 组隔离场景通过。覆盖中文空格路径、进程退出后服务可用、无需重下载的重复或不降级、双向换包、未知锁／任务／占用端口拒绝。0.3.3（现存旧归档）与 0.3.4（历史源构建夹具）升级及启动后故障注入回滚通过；保留配置、数据库、访问钥匙和 Credential Manager 测试凭据。 |
| Codex 与 ACL | 安装前后 Codex 配置字节一致，助手拒绝非受管同名项、重复配置无改动；验证钥匙、配置及备份 ACL。隔离 Codex app-server 分别连接两种包型并核对 `teamsight_status` 的版本和 `instanceId`。 |
| 发布检查 | 两个最终 Windows 入口通过 5.1 解析；macOS 固定入口生成校验通过；合站工作流通过 `actionlint`，发布脚本通过 `bash -n`。未触发工作流或线上写入。 |

## Issues

- 本机初跑发现 Windows PowerShell 5.1 解压较长依赖路径失败；改用受控的本地扩展路径后复验通过。
- 验收脚本初跑从 PowerShell 7 启动时继承了错误的模块路径，且计划任务根路径转义有误；已修正夹具，不更改系统环境。残留的隔离任务已按原任务签名核对并清理。

## Not Tested

- 真实注销／重新登录、系统重启及休眠恢复；手动启动和安装进程退出不是这些场景的验收。发布工作流保留真实登录验收门槛。
- GitHub Actions 在线运行、正式 Release／Pages、匿名接收机及 Codex 桌面原生 Apps。未推送、打标签或部署。

## Artifacts

- 方案：`artifacts/plan/20261118_1532_windows-one-click.md`。
- 5.1 端到端证据：`.local/validation/windows-pages-v035/acceptance.json`；原生双包证据：`.local/validation/windows-native-035/acceptance.json`；最终本机生成入口：`.local/windows-pages-035-final`。
- Windows bundled ZIP SHA-256：`8a87f37c8be73a1efbea3e416a56d0073e7a84cb483ee6fa88ad9a82df5689ae`；external ZIP SHA-256：`c7924eb24ef0684a1e035df68f0305079a75555816f0a6faaf0a55f0ec2ab6d9`。
