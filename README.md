# TeamSight MCP

TeamSight 0.3.0 是 TAPD 本地 MCP 服务，提供团队排期、工时与风险分析、甘特图、报告导出和受控任务写入。使用 Node.js 22.14+（低于 23）及 pnpm 10.12.4。

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
