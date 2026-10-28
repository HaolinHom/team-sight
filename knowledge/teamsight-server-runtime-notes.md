# TeamSight Server / MCP Apps 运行知识

> 验证与提升日期：2026-10-28。适用技术方案 v1.2 的 P0 原型；macOS 26.7 arm64，Codex 26.1016.62342 / build 21477、CLI 0.156.0。其他平台、宿主与版本需单独验收。
> 本文经用户明确要求由候选提升，仅记录已验证事实及其边界，不表示用户已确认 P0 阶段通过或授权实施 P1a。

## 已验证事实

- 旧 App 保留根目录 Vue/Tauri 入口。P0 服务位于 `apps/server`，Vue MCP Apps 原型位于 `apps/mcp-ui`，工作区使用 pnpm。正式核心提取及业务接口尚未实施。
- 已锁定并实际在 macOS arm64 运行的组合为 Node.js 22.23.4 / Node-API 10、pnpm 10.12.4；MCP core/server/client 2.4.0、Node adapter 2.1.2、Apps 2.0.4；better-sqlite3 13.0.3、keyring 2.1.2、resvg 2.6.2。
- MCP SDK 2 使用拆包及 Node 适配器，不能套用旧 SDK 1.x 的导入路径。Apps registerAppTool / registerAppResource 与非 React App 类可用于自包含 Vue 资源；当前 Codex 版本的真实表单打开、读写、冲突、失败重试和重启恢复已独立验证，其他宿主仍需验收。
- `pnpm p0:build` 构建原型；`pnpm p0:test` 验证契约；`node apps/server/verify.mjs` 用两个真实客户端与两次真实服务进程验证持久化及 native 能力。自动脚本通过不等于 Codex Apps 或宿主调度通过。
- 服务、MCP、SQLite 和资源管理共用一个 Node 进程。HTTP 只监听 127.0.0.1，Bearer、Host 和 Origin 同时验证；MCP 使用 /mcp，Apps 通过宿主通信桥。
- better-sqlite3 使用 WAL 和同步短事务。锁等待实测约 1 秒，期间阻塞事件循环；异步函数外壳不能消除这种阻塞。P0 的测试凭据存在系统凭据库，SQLite 只保留 UUID 引用和配置修订。
- JS 验证包没有 Node 运行时，不依赖安装者编译 native；以无符号链接的生产依赖树分平台交付。Windows optional native 包需要在构建时额外准备；结构及 PE 校验不等于 Windows 实际加载验收。
- 包中 versions.json 包含工作区源码哈希，checksums.json 包含内容哈希。未提交实现不能只以旧 Git HEAD 标识版本。
- macOS 下 iTerm 提示符可能恢复旧 Node PATH；应在实际构建/验收脚本内显式选择锁定版本并记录 node --version。仅安装新版本不证明测试已使用新版本。
- 在本次 Codex 会话中，模型仅发现状态、打开设置和渲染三个工具，app-only 读写及凭据动作由真实卡片经宿主桥调用；此可见范围是当前宿主观察，不是权限或保密保证。UI 密码输入、服务/SQLite/宿主日志应分别核查，不能把 Agent 自己填写测试哨兵的脚本记录当作 UI 泄漏证据。
- 两张 Apps 卡片持有独立配置修订，可复现实测旧修订冲突；它与两个不同 Codex 对话线程的 UI 验收是不同范围，报告必须注明。当前正常服务重启后，原卡片可重新读取配置并核对系统测试凭据；未扩大到崩溃、休眠或自动启动。

## 验收边界与已知限制

当前 Codex 版本的 MCP 设置页经用户实查只有命令/URL 配置，未见 `.mcpb` 文件导入入口；本轮按已验证的 JS + HTTP 路径交付，没有执行文件安装，也不扩大为所有版本或插件入口都不支持。凭据核查只覆盖本轮可访问的结果、日志与存储，没有承诺宿主内部不记录秘密。宿主自动化已真实调用同一服务并清理，但精确时刻语义存在偏差。Windows、其他架构、STDIO 和 Linux 均不能写成通过。

## 依据

[P0 macOS 验收报告](../artifacts/report/20261028_teamsight-p0-macos_测试报告.md)及[Codex 宿主补充报告](../artifacts/report/20261028_teamsight-p0-codex_测试报告.md)中的版本清单、自动测试、独立运行、真实卡片、系统凭据和中文 PNG 证据。引用这些结论时，应保留平台、宿主版本、接入方式和取证范围的边界。
