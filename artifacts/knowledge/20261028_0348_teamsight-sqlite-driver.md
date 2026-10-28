# TeamSight Server SQLite 驱动选型候选

状态：候选；已由用户确认更新技术方案，尚未提升为正式 knowledge。

## 来源与范围

用户明确继续使用 SQLite，放弃 `node:sqlite`，并要求将第三方驱动选型结论写入[技术方案 v1.2](../plan/20261027_2341_teamsight-server-mcp-apps-technical-plan.md)。本候选记录已确认的设计取舍，不代表服务或发行物已完成兼容验收。

## 已确认结论

- 本地存储采用 SQLite + `better-sqlite3`，首版以 Node.js 22 LTS 为基线。
- 当前核对的驱动版本为 13.0.3；v13 使用 Node-API 10，对 Node.js 22 分支的兼容起点为 22.14.0。实际发布的驱动补丁与 Node.js 维护版本在 P0 验证后固定。
- MCP 与应用服务继续共用一个 Node.js 进程；发布物为 JS 代码、生产依赖与 MCP Apps 资源，不携带 Node.js 运行时。
- SQLite 引擎与目标平台的 `.node` 原生模块随依赖交付，保留加载路径；不要求最终用户安装 SQLite 或临时编译原生模块。
- 数据库保存配置、修订、回执与快照/分析/产物元信息；大型快照与图表保存为文件，TAPD 凭据独立进入系统凭据存储。
- 使用参数化 SQL、版本化迁移、短事务与串行写入。同步查询不能通过包装 `async` 避免阻塞；Worker 线程仅作为量测发现明显阻塞后的选项。

## 依据与验证边界

- [better-sqlite3 v13 发布说明](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)：Node-API 与随 npm 包交付预编译模块。
- [v13.0.3 构建配置](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/binding.gyp)：`NAPI_VERSION=10`。
- [Node-API 版本矩阵](https://nodejs.org/api/n-api.html#node-api-version-matrix)：Node-API 10 的 Node.js 22 兼容起点。
- 本次仅核对技术方案内容；macOS/Windows 原生加载、实际数据库行为与最终 Bundle 尚未运行验证。

## 建议提升目标与待确认项

建议在正式沉淀时新建 `knowledge/teamsight-server-storage.md`，索引归属在提升时确定。提升前确认实际发行物、Node.js 与驱动版本，以及 P0 的跨平台原生模块加载和数据库读写结果；仅在用户明确要求提升后写入正式知识。

