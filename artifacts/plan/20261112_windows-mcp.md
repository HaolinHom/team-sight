# Windows 构建、安装与运行实施方案

## Summary

在 Windows 10 x64 完成构建、双版本发行验收、当前用户安装和登录后后台运行，并接入 Codex。Node 通过本机 nvm 管理，验收使用隔离 TAPD 数据。

## Implementation Plan

1. 通过 nvm 安装并切换 Node 22.23.4，保留已有版本，配置 pnpm 10.12.4；不改变 PowerShell 执行策略。按锁文件安装依赖、构建、完整测试，修复实际 Windows 兼容问题。
2. 构建 win32-x64 bundled/external ZIP 和校验清单；扩展发行验收以支持单平台及 Windows 原生运行；修正平台测试假设，使用 junction 验证 Windows 链接拒绝，明确跳过 macOS 专属测试。保持 MCP、数据库、配置契约不变。
3. bundled 安装至当前用户 LocalAppData/TeamSight MCP，程序、数据、日志、备份分开；管理入口提供安装、启动、状态、停止、卸载，卸载保留数据与凭据。以当前用户非管理员登录计划任务隐藏运行，固定包内 Node，不受 nvm 切换影响。
4. 默认监听 127.0.0.1:43127，未知占用或锁不接管；备份后配置 Codex URL 和本机认证，保护含令牌文件，保留其他连接及审批设置。失败撤销本次后台任务与配置变更并保留诊断。

## Test Plan

- 构建、完整测试、凭据泄漏检查；双 ZIP 文件集合、哈希和原生模块架构核验。
- 两种包分别验收 SQLite、Windows 凭据库、PNG、隔离 MCP；external 使用 nvm Node 22。
- 中文和空格路径、参数、退出码、启动/状态/停止；bundled 独立性及损坏/缺失拒绝；external 不兼容 Node 诊断。
- 隔离数据跨两包切换保留；后台任务重启、终端关闭后持续运行。
- 安装实例版本、37 工具、2 资源、teamsight_status；Codex 重连后设置及可用隔离分析卡片另行验收。

## Assumptions

- 正式服务使用 bundled，external 验收并保留产物。
- 不操作真实 TAPD、不发布包、不扩展公网下载安装器。
- 不主动重启电脑或中断当前 Codex；未执行的重新登录/重启明确列为未验收。若宿主须重连，服务与配置完成后提供操作并继续宿主验收。
