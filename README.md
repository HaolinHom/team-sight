# TeamSight MCP

TeamSight 0.3.3 是 TAPD 本地 MCP 服务，提供团队排期、工时与风险分析、甘特图、报告导出和受控任务写入。默认发行包自带私有 Node 22.23.4，无需用户安装 Node；精简版需要外部 Node 22.14+（低于 23）。源码开发使用 Node 22.23.4 及 pnpm 10.12.4。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
node apps/server/dist/cli.js doctor
pnpm mcp:serve --data-dir .local/teamsight-mcp --port 43127
```

在宿主配置 `http://127.0.0.1:43127/mcp`，本机访问令牌来自数据目录的 `access-token`，应通过宿主的令牌环境变量配置。TAPD 令牌在设置卡片填写并保存至系统钥匙串，不在对话输入。

- [MCP 能力与使用说明](docs/TeamSight-MCP-能力与使用说明.md)
- [服务、迁移与故障排查](apps/server/README.md)
- [运行包及平台验收](docs/validation/teamsight-mcp-platforms.md)

独立 Tauri App 已退役。根 `build`、`test` 执行全部 MCP 构建和测试；不再提供桌面开发、打包或旧 MCP 命令。历史方案、报告和知识记录仅描述对应版本，不代表当前运行方式。

## macOS Agent 自动安装

[复制给 Agent 的安装说明](docs/install/macos-agent-install.md)通过固定提交的 HTTP GET 获取独立 install.sh，再自动下载并校验 0.3.3 的 bundled/external 包、配置登录后后台服务和 Codex 认证。默认 bundled，精简版复用已安装 Node。该入口须先发布脚本与 Release 资产并公开仓库，接收端验收边界见说明；不会修改封存的 0.3.3 包。

## 发行包

执行 `pnpm mcp:package all` 同时生成 macOS arm64、Windows x64 的 bundled（推荐，自带 Node）与 external（精简）四份压缩包。下载后通过 `launch.sh`／`launch.ps1` 启动；验证及状态脚本通过 `run-node.sh`／`run-node.ps1` 执行，参见[平台说明](docs/validation/teamsight-mcp-platforms.md)。Node 不会安装到全局或修改系统 PATH。
