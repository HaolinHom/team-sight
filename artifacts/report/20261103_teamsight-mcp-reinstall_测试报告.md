# TeamSight MCP 重新安装测试报告

## Summary

将已构建的 macOS arm64 0.2.0 包安装到用户持久目录，恢复 Codex teamsight Streamable HTTP 登记。使用 Node.js 22.23.2。未修改业务源码。

## Results

- 已校验安装包全部 2130 个文件，SHA256 无不一致。
- 原 P1b 数据目录已备份后复制迁移，配置 schemaVersion 5；保留项目及成员范围。系统凭据实际读取成功，无秘密输出。
- 原实例 PID 15651、83033 均不存在；43127 无监听。新目录仅移走复制的陈旧锁，原数据及原锁保留。未结束其他进程。
- LaunchAgent cn.teamsight.mcp 正常运行，登录自动启动；服务仅监听本机 127.0.0.1:43127。
- 首次后台启动的 Node 路径不存在，已改为实际 nvm Node.js 22.23.2 绝对路径并重启通过。
- 真实 MCP SDK 连接通过：phase MCP、version 0.2.0、45 个工具；teamsight_get_config 配置读取、teamsight_open_settings 及设置资源读取通过。
- Codex CLI 读取登记通过：teamsight enabled=true、streamable_http、正确 URL、Authorization 已配置。Codex 配置文件权限 0600，原配置已备份；其他 MCP 条目保留。

## Issues

未发现阻止本次安装使用的问题。

## Not Tested

本轮未验证 Codex 原生卡片的点击／保存与当前聊天热加载；需新聊天加载新连接。未进行 TAPD 写入、Windows 验收或重复运行此前完整回归。凭据可读取不等于本轮验证 TAPD 令牌的远端有效期。

## Artifacts

- 安装目录：/Users/haolin/Library/Application Support/TeamSight MCP/versions/0.2.0
- 正式数据：/Users/haolin/Library/Application Support/TeamSight MCP/data
- 备份：/Users/haolin/Library/Application Support/TeamSight MCP/backup-p1b-20261103
- Codex 配置备份：/Users/haolin/Library/Application Support/TeamSight MCP/config.toml.before-install
- 启动配置：/Users/haolin/Library/LaunchAgents/cn.teamsight.mcp.plist
- 脚本：/Users/haolin/Library/Application Support/TeamSight MCP/start.zsh
- 验收日志：/Users/haolin/Library/Application Support/TeamSight MCP/logs/install-verification.log
- 登记核验：/Users/haolin/Library/Application Support/TeamSight MCP/logs/codex-registration.log
- 系统凭据核验：/Users/haolin/Library/Application Support/TeamSight MCP/logs/credential-check.log

本机 MCP 认证值仅写入用户本机配置，未写仓库或报告。
