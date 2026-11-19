# macOS 公网一键安装测试报告

## Summary

2026-11-18，在 macOS 26.7 arm64、Codex CLI 0.156.0 上验收 TeamSight `v0.3.5` 两个公开 Pages 入口和正式 Release 资产。标签及包内 `sourceHead` 均为 `aaa895f087ebd67e2cac6800d55128e24e451d60`。

为保留现有生产 MCP，安装用公开入口的原始脚本字节和已匿名下载的正式归档，通过脚本内置 `--test` 模式执行。归档经回环 HTTPS 提供；两次安装分别使用独立目录、端口和 LaunchAgent 标签。公网直连下载单独检查，不把回环测试视为原样命令通过。

## Results

| 检查项 | 发行包 `install-mcp` | 精简包 `install-mcp-external` |
| --- | --- | --- |
| Pages 匿名获取及脚本对照 | 通过 | 通过 |
| Release 完整归档及 SHA-256 | 通过；分段匿名下载 | 通过；分段及直连的字节一致 |
| 归档直连下载，单次上限 300 秒 | 超时；收到 13,862,861 / 48,819,246 字节 | 通过；HTTP 200，11,773,825 字节，约 166 秒 |
| 隔离安装、LaunchAgent 启动及 MCP 握手 | 通过；采用内置 Node，`PATH` 无外部 Node | 通过；采用 arm64 Node 22.23.4 |
| 隔离 Codex 配置助手及 `teamsight_status` | 通过；实例 ID 和版本与回执一致 | 通过；实例 ID 和版本与回执一致 |

- 用标签源码和正式归档重建两个脚本；只规范化 esbuild 生成的源码路径注释后，均与对应 Pages 脚本逐字节一致。
- 两次安装均返回 `schema: 1`、`action: installed` 和 `service: verified`；连接钥匙文件权限为 `0600`，钥匙未出现在输出中。安装未改隔离 Codex 配置，另行调用配置助手保留了既有条目。
- 测试结束后确认隔离 LaunchAgent 均已移除，生产服务 PID、安装状态、LaunchAgent 文件、钥匙及当前 Codex 配置未变化。没有执行 TAPD 写入。

## Issues

- 本机匿名直连下载发行包时触及安装器同样的 300 秒传输上限。分段可下载完整归档且哈希正确；这一结果说明本次直连未达标，不表示资产损坏或所有网络均会失败。
- 首轮清理检查在 `bootout` 返回后立即查找标签，早于注销完成；随后确认对应测试标签和监听均已消失，最终轮等待注销后全量重测并正常清理。

## Not Tested

- 未在当前账户执行两条无参数生产命令：固定的 `cn.teamsight.mcp` 标签及 `127.0.0.1:43127` 属于现有服务。仍需在干净的 macOS arm64 账户或 VM 补验原样命令和真实重新登录。隔离 Codex app-server 验证不等于测试当前生产宿主重连或原生 Apps 交互。

## Artifacts

- [公网校验日志](evidence/20261118-public-macos-install/verify-public.log)、[发行包直连日志](evidence/20261118-public-macos-install/public.log)、[精简包直连日志](evidence/20261118-public-macos-install/direct-external.log)。公网校验日志末尾的字节差异为未经规范化的路径注释；规范化对照结果在隔离日志中。
- [最终隔离安装日志](evidence/20261118-public-macos-install/isolated-final.log)、[结构化结果](evidence/20261118-public-macos-install/public-install-results.json)。
