# Windows CI ZIP 创建崩溃修复测试报告

## Summary

GitHub Actions Windows runner 的小归档回归通过，但系统 `tar.exe` 创建正式发行 ZIP 时以 `3221225477`（`0xC0000005`，访问冲突）退出。改用仅供构建的固定版本 Node ZIP 写入器，从已生成的文件清单流式创建 ZIP；不再调用 `tar.exe` 创建 Windows ZIP。macOS 归档指令、Windows 归档目录契约和校验流程保留。

## Results

- 隔离检出目录使用 macOS arm64、Node.js 22.23.4、pnpm 10.12.4。`pnpm install --frozen-lockfile`、`pnpm mcp:build`、`git diff --check` 通过。
- 脚本回归 24 项全部通过，包含两种归档往返、包含空格的暂存路径、ZIP 顶层目录和 `checksums.json`、ZIP 源文件缺失时拒绝。
- 新写入路径生成完整 Windows 双包：bundled 2,136 个清单文件，external 2,134 个。两包通过 SHA-256、文件集合、PE x64、公共内容一致性及独立的 `unzip -tq` 校验，两个 Windows Pages 入口均生成。
- macOS 双包打包和原生验证通过，两个 macOS Pages 入口成功生成并通过 `sh -n`。未执行真实 TAPD 写入。

## Issues

- 未定位系统 `tar.exe` 的内部崩溃原因；ZIP 创建不再依赖发生崩溃的命令。解包官方 Node 和独立验包仍使用原有归档读取路径。

## Not Tested

- 未运行修复后的 Windows GitHub Actions、Windows 安装、Codex 或正式发布／部署；Windows 归档结构验证在 macOS 完成，不能替代 Windows runner 原生验证。

## Artifacts

- `scripts/package-mcp-lib.mjs`、`scripts/package-mcp.mjs`、`scripts/test/package-mcp.test.mjs`
- 本机日志：`/private/tmp/teamsight-zip-writer.PZ7ycg/check.log`
