# Windows CI 中文解包路径修复测试报告

## Summary

用户贴出的 Windows Actions 日志显示 bundled 与 external ZIP 均已打包成功。后续 `mcp:package:verify` 调用 `tar.exe -C` 时，日志中的 `extracted 中文 …` 变为 `extracted ?? …`，导致切换到解包目录失败。本次保留中文验收路径，改用 Node 流式解包 Windows ZIP，不改变 macOS `.tar.gz` 路径。

## Results

- 在隔离检出目录中用 macOS arm64、Node.js 22.23.4 和 pnpm 10.12.4 执行冻结锁文件安装、项目构建及脚本测试，25 项全部通过。
- 新用例覆盖中文的归档名、源目录、解包目录及包内文件名，以及不符合预期顶层目录时拒绝写入。正式验包继续核对归档 SHA-256、文件集合和包内 SHA-256。
- Windows 官方 Node ZIP 及完整 Windows 发行双包经新逻辑解包。Windows 发行双包在含中文和空格的证据路径通过结构、PE x64、哈希及 `unzip -tq` 独立核验；生成两个 Windows Pages 入口。
- macOS 双包通过原生验证，两个 macOS Pages 入口生成并通过 POSIX 语法检查；未发送真实 TAPD 写请求。`git diff --check` 通过。

## Issues

- 原错误发生在 ZIP 创建之后、原生验收之前；日志不能证明后续 Windows 原生验证已通过。

## Not Tested

- 未在 Windows runner 上执行修复后工作流。本地 Windows 归档验证是跨平台结构验证，不代表 PowerShell 启动、SQLite、凭据库、Codex 或正式部署通过。

## Artifacts

- `scripts/package-mcp-lib.mjs`、`scripts/verify-mcp-packages.mjs`、`scripts/test/package-mcp.test.mjs`
- 本机日志：`/private/tmp/teamsight-unicode-zip.wzEJg8/check.log`
