# TeamSight P1b 运行与 TAPD 写入知识候选

状态：候选，未提升正式 knowledge。依据为本轮源码、33 项包级测试、旧 App 386 项回归及项目 `62119705` 的真实创建/修改验收。关联 [测试报告](../report/20261028_teamsight-p1b_测试报告.md)。

## 共享核心与运行入口

- `packages/core/src/statistics.ts`、`hoursSettings.ts`、`calendar.ts`、`layout.ts`、`filters.ts` 为纯实现；旧 `src/hours`、`src/calendar`、`src/gantt` 入口 re-export 对应模块，旧 App 与服务使用同一计算口径。
- 新的分析上下文与风险规则位于 `packages/core/src/analysis.ts`。`snapshotId` 标识原始来源，`analysisId` 标识确定规则的计算结果；后续图、表、风险和报告复用同一分析。
- `apps/server/src/business.ts` 持有共享 TAPD 请求队列、缓存失效、写入与分析作业；`business-tools.ts` 注册 MCP 工具和文件资源；`outputs.ts` 输出安全模板及中文图表。
- `pnpm p1b:build` 构建四个包/应用，`pnpm p1b:test` 运行 core/tapd/server 测试。服务仍使用外部 Node.js 22；本轮实测 22.23.4、Node-API 10、pnpm 10.12.4。

## 持久化与幂等回执

- SQLite schema v3 在 v2 配置/缓存基础上增加 `operations`、`documents`、`jobs`。大型快照、分析和文件放在数据目录 `files/`，元信息记录 MIME、大小、SHA-256、来源 ID 与 `teamsight://artifacts/{id}`。
- 服务以短事务预留幂等键并保存字段哈希/请求摘要。相同键和参数返回已有回执；不同参数返回 `IDEMPOTENCY_KEY_CONFLICT`。回执不保存令牌或敏感正文。
- `pending` 重启标记失败，已发出的 `in_flight` 重启标记 `unknown`；运行中的分析作业标记 `interrupted`。不得为重试清空数据目录或删除待核实回执。
- `tapd_verify_operation` 只读取远端。已知远端 ID 时直接核对；未知时先搜索标记对象，再传 `candidateId`。本地幂等不是 TAPD 恰好一次，摘要比较也不是原子 CAS。

## 已实际验证的 TAPD 契约

- story/task 创建和修改均走已登记的 POST 表单端点；不根据 REST 风格推导 PATCH/PUT。单项读取使用 `/tasks?id=...`、`/stories?id=...`，校验项目和精确 ID。
- TAPD 单人 `owner` 读回会补末尾分号 `;`；比较前将账号列表拆分、去空项并排序。`effort` 的等价数字字符串也需规范化。真实需求的首个 unknown 回执通过此规则只读恢复，未重新发送创建。
- 写入范围为 `tapd.writeAccess.workspaceIds/operations/fields`，迁移默认禁用。身份必须使用项目成员目录中的完整账号，名称或工号只用于返回候选。任务状态采用已登记文档固定值，需求状态取项目元数据。
- `packages/tapd/src/contracts.ts` 同时生成常用 MCP 输入和操作目录 JSON Schema。目录操作 `task.create` 等由操作 ID 决定类型，其参数不带 `entityType`；通用调用不能绕过范围及额外字段校验。
- 全服务并发 3；GET 有限重试，POST 单次发送；完整分页最多 50 页×200 条。重复 ID、非法列表、count 与短页不一致及预算截断均不能返回完整。

## 分析与 Apps 验证边界

- 每日实际和累计花费独立读取，累计不按当前负责人过滤。完整原始快照短缓存保留来源时间；别名/规则变更可复用事实，写入使缓存失效，旧分析不变。
- 小时请假按 `max(每日目标−请假小时,0)` 扣减；当前未结束日只报告进度。未知和部分数据不能作为零工时或无风险；成员范围不等于扫描无负责人。
- Apps 的 index/settings/analysis 分别作为独立入口自包含构建；P1b 设置与分析 URI 带版本，避免旧宿主资源缓存。
- 官方 SDK AppBridge 的浏览器检查验证了分析图表、明细与导出，但不能证明 Codex 原生卡片通过。本轮原生界面工具拒绝操作 Codex，该项必须单列待人工验收。临时测试宿主不属于产品网站或发布包。

## 建议提升

- 运行与持久化事实建议并入 `knowledge/teamsight-server-runtime-notes.md`。
- API 方法、分页、参数契约和 owner 归一化建议并入 `knowledge/tapd-api-workitem-queries.md`；unknown/重试边界可补入 `knowledge/tapd-api-auth-and-errors.md`。
- 提升需用户明确授权；候选事实不代表 P1b 阶段已经确认通过。真实 Codex 卡片结果、Windows 与 P1c 发行/定时验收需以后按实际结果补充。
