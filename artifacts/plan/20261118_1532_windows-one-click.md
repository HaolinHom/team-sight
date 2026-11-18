# TeamSight Windows x64 一键安装实施方案

## Summary

- 在当前分支实现 0.3.5 的 Windows bundled／external 一键安装，支持普通用户的系统 Windows PowerShell 5.1。本轮本机验收并补齐发布流程；不推送、不打标签、不部署。
- 不切换本机 0.3.3 受管服务；使用隔离目录、端口、计划任务与 CODEX_HOME。

## Implementation Plan

- 生成固定 HTTPS 地址、版本和 SHA-256 的 `install-mcp.ps1`／`install-mcp-external.ps1`，在执行前验证归档、解压路径和文件清单。使用私有 Node 或固定已验证的 x64 Node 22.14+（<23、Node-API 10+），不更改 PATH、nvm 或执行策略。
- 用当前 SID、登录任务和受保护 ACL 管理服务。识别 0.3.3／0.3.4 受管安装，支持数值版本比较、无下载复用、换包、安全升级和回滚；不接管未知任务或实例，保留数据和凭据。
- 仅在健康检查和 MCP 状态一致后给出 schema 1 回执。安装不访问 Codex 配置；单独助手验证服务、备份和安全更新 CODEX_HOME，不覆盖非受管连接或输出钥匙。
- 同一 Release 汇集四个归档，匿名校验后部署包含四条入口的 Pages；保留整站恢复及 Windows 验收发布门槛。

## Test Plan

- 非管理员、原执行策略下走隔离 HTTPS 和真实 5.1 两条 `irm | iex`，检查无 Node PATH、运行时拒绝、中文空格、下载损坏、重复安装、双向换包、升级、不降级和失败回滚。
- 核对 ACL、数据与凭据、端口和任务冲突，以及安装退出后隔离 Codex 实际调用 `teamsight_status`；不进行真实 TAPD 写入。

## Assumptions

- 真实重新登录需用户配合，未完成须单列。公网验证及接收端验收留待合并后。
