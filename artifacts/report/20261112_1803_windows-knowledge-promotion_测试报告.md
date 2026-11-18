# Windows 运行知识提升测试报告

## Summary

按用户“提升候选知识”的明确指令，将 Windows 构建、双包原生运行、PowerShell 7 本地后台安装及 Codex 连接设置卡片验收结论合并至正式运行知识，并同步知识索引。仅进行文档、源码和既有证据的静态对照，本轮不重新运行服务验收。

## Results

- `knowledge/teamsight-server-runtime-notes.md` 新增 Windows 章节，覆盖 nvm 开发环境、单平台发行验收、PowerShell 策略差异、本地安装命令、用户级登录任务、管理操作、SID/DACL、junction 及验收边界。
- 索引 `knowledge/index/local-environment-index.yaml` 同步摘要与标签，移除当前摘要中已过时的“Windows 仅结构/PE 通过”；正文历史报告段落保留当轮事实并指向后续 Windows 实测。
- 核对安装器、发行验收脚本、package.json 与三份已保存的 acceptance/installed JSON，均支持提升结论。原始 Windows 测试报告及用户确认支持 Codex 工具连接和连接设置卡片显示结论。
- 新增 5 个相对链接全部存在；知识关键内容、索引摘要和候选生命周期断言通过，`git diff --check` 通过。
- 已删除全部提升完成的 `artifacts/knowledge/20261112_windows-mcp_知识候选.md`，不保留重复候选。

## Issues

全篇链接检查发现以下 3 个原有历史报告在当前仓库缺失；经与 HEAD 对照确认均非本次新增，保留历史引用，不据此宣称当前证据缺失：

- `artifacts/report/20261109_双版本发行_mcp033_测试报告.md`
- `artifacts/report/20261109_精简版更新MCP033_测试报告.md`
- `artifacts/report/20261110_macos-http-agent-install_测试报告.md`

## Not Tested

未重新构建、安装、部署或执行真实 TAPD 操作。本次提升保留完整分析卡片、真实 TAPD 业务、重新登录、系统重启及休眠恢复未验收边界；任务重启不代表真实系统重启通过。本轮未修改服务或安装器代码。

## Artifacts

- 正式知识：`knowledge/teamsight-server-runtime-notes.md`
- 知识索引：`knowledge/index/local-environment-index.yaml`
- 原始验收报告：`artifacts/report/20261112_1622_windows-mcp_测试报告.md`
- 原始证据：`artifacts/validation/windows/packages-final/acceptance.json`、`installer-3/acceptance.json`、`installed-mcp.json`
