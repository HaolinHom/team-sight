# TeamSight 阶段1 实施方案：本地凭据文件、配置管理与成员过滤

## Summary

- 目标：按技术方案阶段1 补齐缺口——Token 配置、项目/成员配置维护、加载与部分失败状态，并用模拟数据与真实 API 分别验证。
- 现状（阶段0 已完成，无需重做）：请求层与分页、统一任务模型与字段映射、并发控制与部分项目失败隔离、构建/测试命令、真实接口验证链路。
- 本轮新增能力：`GET /workspaces/user_participant_projects` 枚举用户全部项目（实测 14 个）；本地凭据文件读写；项目/成员配置持久化；按配置成员过滤与多负责人多行拆分。
- 有意偏离（已确认）：① 凭据为本地明文文件，暂不接系统钥匙串（技术方案 §4.3 的加密存储顺延，接口预留以便后续只改 Rust 实现）；② 多负责人任务拆成多行；③ 浏览器开发模式 Token 存 localStorage（仅开发用途）。

## Implementation Changes

**Rust 侧（src-tauri）**

- 凭据：新增 `credential_set / credential_status / credential_delete` 命令，写入 Tauri 应用配置目录下的 `credentials.json`，文件权限 `0600`；不引入 `keyring` 依赖。
- 绝不回传明文：`credential_status` 只返回 `{ configured, source: 'file' | 'env' | 'none', maskedHint }`，设置页只能看到掩码。
- Token 解析顺序：本地文件 → 环境变量 `TAPD_PERSONAL_TOKEN` → `.env.local`（仅 debug 构建）。
- 配置：新增 `settings_read / settings_write` 命令，读写同一目录下的 `settings.json`；写入采用「先写临时文件再重命名」。
- 保留阶段0 的 `tapd_get` 只读代理与接口路径诊断日志（不记录参数值与凭据）。

**前端（src）**

- 新增 `src/services/credentials.ts`、`src/services/settings.ts`（Tauri 走 Rust 命令；浏览器走 localStorage 并标注「仅开发模式」），配套 `useCredentials`、`useSettings`、`useSchedule` 三个 composable。
- 新增设置页 `/settings`：Token 保存/清除/连通性测试；项目列表从 TAPD 拉取 `category=project` 条目（ID/名称随 TAPD，新增默认禁用，颜色默认随机分配且可改）；成员维护（搜索添加/移除，候选池来自已启用项目成员目录聚合去重）。
- 数据层：`ScheduleTask` 增加 `assigneeIds: string[]` 保留全部负责人工号；新增成员解析工具，按配置成员名单决定任务归属与可见性。
- 颜色分配：从内置调色板取当前未被占用的颜色（随机起点），写回配置，不随渲染变化。
- PoC 验证入口改为读取设置中的项目与成员，展示每项目成功/失败状态与窗口内条数，保留 mock 与真实数据两种来源。

**知识库更新**

- 更正 `knowledge/tapd-api-auth-and-errors.md` 中「项目清单不能通过接口自动发现」：已验证 `GET /workspaces/user_participant_projects` 可枚举（14 个项目，无分页），并补充 `/workspaces/users` 不支持按姓名过滤、项目名称来源。按 `rules/knowledge.md` 先生成候选，经确认后再提升。

## Interfaces and Data Contracts

- Rust 命令：`credential_set(token: string)`、`credential_status()`、`credential_delete()`、`settings_read()`、`settings_write(settingsJson: string)`、`tapd_get(path, params)`。
- 本地文件：应用配置目录下的 `credentials.json`（0600）与 `settings.json`；两者分离。
- `AppSettings`（`schemaVersion: 1`）：`projects: { id, name, enabled, color }[]`、`members: { staffId, name }[]`、`updatedAt`。
- 新增 TAPD 调用：`GET /workspaces/user_participant_projects`（项目清单）、`GET /quickstart/testauth`（连通性测试）；沿用 `/workspaces/users`、`/tasks`、`/bugs`。
- 成员解析规则：任务 `assigneeIds` 与配置成员求交集，命中的每个成员各生成一行；交集为空（含无负责人）→ 任务不展示。
- 错误分类：HTTP 422 → 凭据失效引导重配；HTTP 403 → 项目级失败，保留其他项目数据并明确提示。

## Test Plan

- 单元测试：配置默认值与颜色分配持久化、成员增删去重、多负责人拆行与交集为空过滤、凭据服务在 Tauri/浏览器两种运行时的分支（mock invoke）、错误状态码到用户提示的映射、配置文件缺失或损坏时回退默认并提示。
- Rust 手工测试（`cargo test -- --ignored`）：凭据文件写入/读取/删除往返（含 0600 权限断言，用临时目录并清理）、`settings.json` 读写往返。
- 端到端（走 iTerm，输出落盘）：`pnpm test`、`pnpm build`、`pnpm tauri:dev`；设置页保存 Token → 测试连接 → 拉取并启用项目 → 添加成员 → 验证入口加载真实数据，核对「仅配置成员可见」与「多负责人多行」。
- 安全检查：`dist/` 与运行日志扫描确认无 Token 明文；确认 `credential_status` 不外泄完整令牌；确认凭据文件位于仓库之外且权限为 0600。

## Assumptions

- 阶段1 接受「本地明文存储」这一已知取舍：文件位于用户应用配置目录、不进仓库、权限 0600，并在设置页显式提示；后续切换系统钥匙串时只替换 Rust 实现与 `source` 取值，前端契约不变。
- 浏览器模式仅用于开发调试，其 localStorage 行为不进入生产路径。
- 阶段1 不实现时间范围/状态筛选、任务详情面板与正式看板布局（属阶段2/3）；PoC 页面仅作为数据接入验证入口。
- 项目列表只含 `category=project`，来源为当前 Token 所属用户；名称以 TAPD 返回为准，不手工捏造。
- 成员名单为全局白名单（按工号去重、跨项目复用），不做按项目区分。
- 配置不包含筛选偏好（阶段3 再加），避免为未实现功能预留字段。
