# Windows 一键安装提交对 macOS 的影响检查

## Summary

逐个审查 `319ae4da7323ed4074b101b8880bf0cbbd30b4f1`、`fd2e796213eee09126ce08f8f799318106b4ed99`，区分 macOS 安装与运行逻辑、共享发布流程及文档变更。测试在 macOS arm64、Node.js 22.23.2 下使用 iTerm 执行。

## Results

- `319ae4d` 新增 Windows 安装入口、构建和测试；macOS 入口生成器、启动脚本、LaunchAgent、安装升级／回滚、Codex 配置助手、服务实现、打包实现及锁文件未修改。组装站点时只新增两个 `.ps1` 并更新首页，不改写两条 macOS 安装脚本。
- `fd2e796` 仅更新文档、知识与验收记录；保留原有两条 macOS URL 与选包说明。
- `node --test scripts/test/*.test.mjs` 共 22 项通过，含 POSIX 启动器、macOS 安装相关逻辑和新增 Windows 清单校验。生成的本地安装脚本与仓库一致（`--check`）。使用本地已有双包作为夹具生成两个 macOS Pages 入口，内嵌归档哈希校验及 `sh -n` 通过。发布脚本 `bash -n` 和 `git diff --check 319ae4d^ fd2e796` 通过。

## Issues

- macOS 无法再单独通过该工作流发布。`build_macos` 受 `windows_acceptance` 门控，后续组装需要两平台构建成功，发布脚本也要求 Windows 资产的清单验证及匿名下载通过。此次提交附带的 Windows 报告将真实注销／重新登录列为未验收；如果该项仍未完成，不应勾选门槛绕过发布。
- Pages 恢复以整站为单位。只有 Windows 入口冒烟失败，也会在首发撤下两条 macOS 入口，或在后续恢复到上一批 macOS 入口。恢复到旧的 macOS-only 产物仍兼容：旧站没有 `.ps1` 时，核对预期为 404。
- 若同版本已作为 macOS-only Release 发布，不可用该双平台流程原地补 Windows 资产：已有标签必须匹配候选 SHA，且只有草稿分支会上传资产。需保留已公开产物并用新版本发布双平台候选。

## Not Tested

- 未触发 GitHub Actions、正式发布／部署或回滚；未重跑 LaunchAgent、实机 Codex 或接收端安装。未切换现有服务。

## Artifacts

- `.github/workflows/macos-release.yml`
- `scripts/publish-mcp-release.sh`
- 本机验证日志：`/tmp/teamsight-commit-review.9rNiRX/review.log`
