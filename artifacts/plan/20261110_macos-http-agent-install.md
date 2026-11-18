# TeamSight macOS HTTP 自动安装实施方案

## Summary

提供独立 install.sh 和可复制给 Agent 的说明。通过固定提交的公开 HTTPS 脚本地址、GitHub Release v0.3.3 下载现有 bundled/external macOS arm64 包，默认 bundled。不依赖 GitHub CLI、GitHub Token、克隆或用户构建；保留封存包和应用版本。仓库公开由用户完成，是匿名线上验收前置条件。

## Implementation Plan

- 安装脚本位于 scripts/install.sh；curl HTTP GET 支持 HTTPS 重定向及超时，脚本和归档均先 SHA-256 校验再执行/提取，不执行 curl 管道，不使用 latest 或失败回退来源。交付说明提供固定提交真实地址和哈希。
- 参数 --version、--variant bundled|external、--node、--status、--uninstall；默认0.3.3/43127。检查macOS arm64；仅解除校验后的本次安装目录隔离。bundled使用私有Node；external验证22.14+且<23、Node-API10+并固定绝对路径，不修改系统Node/nvm。
- 程序安装到 ~/Library/Application Support/TeamSight MCP/versions/0.3.3-<variant>，数据位于data-mcp。先doctor和隔离MCP，再创建用户级cn.teamsight.mcp LaunchAgent，立即及登录后启动，关闭终端不停止。
- 幂等安装；切换时核对实例和活动作业/写入、停止旧实例、备份静止数据。冲突/未知实例/不支持schema停止，不结束未知进程或删锁。失败恢复本次服务与配置并清理暂存。卸载保留数据和钥匙串。
- 尊重CODEX_HOME，默认~/.codex；备份并结构化更新teamsight，保留其他配置和工具审批策略。自动将本机access-token写入http_headers.Authorization，配置/备份0600，不展示凭据；解析逻辑和依赖内嵌于单文件，不要求Python/npm/pnpm。
- 真实MCP验证版本、工具发现、teamsight_status；区分服务可用与宿主已连接，提示重新连接但不重启当前Codex。TAPD凭据仍在卡片填写。

## Test Plan

两种包、含空格目录、无/不兼容系统Node、下载404/超时/中断/哈希错误、隔离、端口、幂等、切换、回滚；LaunchAgent重载/终端关闭、卸载数据保留；其他MCP/注释/嵌套TOML/既有teamsight配置保留。测试使用隔离目录、CODEX配置和LaunchAgent标签，不切本机服务。公开前使用隔离下载源；公开后匿名完整下载和接收端Codex连接须独立验收。

## Assumptions

不扩Windows，不变业务/DBv4/configv6。签名公证另行处理，解除隔离不代表Apple认证。未知旧实例和非支持数据版本不自动接管。现有0.3.3归档保持不变。
