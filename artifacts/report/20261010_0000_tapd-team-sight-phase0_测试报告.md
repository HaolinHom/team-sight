# TAPD 跨项目团队排期看板 阶段0 测试报告

## Summary

- 测试对象：阶段0 交付物（Tauri 2 + Vue 3 工程骨架、甘特图 PoC、TAPD 请求层与字段映射、只读接口验证脚本）。
- 测试方式：单元测试、前端类型检查与生产构建、真实 TAPD 接口只读对照验证、浏览器实测 PoC 视觉验收、Tauri 桌面端启动验证、构建产物凭据泄漏检查。
- 结论：核心结论均已形成；发现并修复 1 个日期工具 bug；TAPD 接口 11 项通过、0 失败；PoC 视觉验收项全部通过；桌面端验证结果见「Results」。

## Results

### 1. 单元测试（`pnpm test`）

- 结果：4 个测试文件、45 个用例全部通过（首次运行 6 个失败，其中 1 个为真实缺陷，已修复）。
- 覆盖内容：日期键校验/天数差/跨月跨年、当前自然月范围（含闰年）、周末判定、窗口相交与裁剪边界；成员分组与稳定排序、折叠后重排、任务条 x/width、跨窗裁剪、缺失日期与日期倒挂归类；任务/缺陷字段映射、`姓名_工号` 解析（含多人与无尾分号）、日期规范化拒绝非法值、去重、成员目录；分页收敛、count 失败降级、错误语义、网络重试、单项目失败隔离。
- 修复记录：`minDateKey` 比较方向写反，导致任务条按整月宽度绘制（`src/gantt/dateUtils.ts`）。

### 2. 前端类型检查与构建（`pnpm build`）

- 结果：`vue-tsc --noEmit` 与 `vite build` 均通过，产物 `dist/`（JS 93.38 kB / CSS 4.68 kB，gzip 后 36.5 kB / 1.15 kB）。
- 过程中修复：vitest 2 内嵌 vite 5 与根 vite 6 类型冲突（升级 vitest 至 3.2.7）；`node:url` 类型缺失（补 `@types/node`）；未使用导入（`POC_PROJECTS`）。

### 3. TAPD 接口只读对照验证（`node scripts/verify-tapd.mjs`）

时间窗 2026-10-01 ~ 2026-10-31，项目 63253157 / 62120799，共 13 项检查，11 项通过、2 项需注意、0 项失败。

| 检查项 | 结果 | 关键证据 |
| --- | --- | --- |
| Bearer 认证 | 通过 | `GET /quickstart/testauth` → 200，`status=1` |
| Basic 认证（令牌作口令） | 通过（确认不可用） | 401 Unauthorized |
| 无效令牌错误路径 | 需注意 | 返回 422 `The access token provided is invalid`（非 401） |
| 项目枚举能力 | 通过 | `GET /workspaces` → 422 `workspace_id is required.`，项目 ID 必须配置 |
| 越权/不存在项目 | 需注意 | 返回 403 `Personal token company does not match workspace`，必须按「项目级失败」上报，不能当作空数据 |
| 任务字段 | 通过 | 关键字段齐全；`owner` 形如 `姓名_工号;`（带尾分号，可多值） |
| 缺陷字段 | 通过 | 标题为 `title`、负责人为 `current_owner`（无尾分号），`name`/`owner` 恒为 null |
| 成员目录 | 通过 | `GET /workspaces/users` 返回 47 人，`user=姓名_工号`、`name=姓名` |
| 分页上限 | 通过 | `limit=200` 实际返回 200 条，耗时 129 ms |
| 时间窗查询 | 通过 | 总量 24272 → 窗口 103；开区间 `begin=~2026-10-31` 返回 24272（被静默忽略） |
| 分页完整性 | 通过 | 窗口内 count=103，逐页累计 103，1 页完成、耗时 214 ms |
| 缺陷总量 | 通过 | 9599 条 |
| 多项目并发 | 通过 | 63253157 窗口 103 / 全量 24272；62120799 窗口 12 / 全量 2904 |

### 4. PoC 视觉验收（浏览器实测 http://localhost:5183）

以固定 mock 数据（3 名成员 + 未分配成员、13 条工作项、4 个项目色、含跨月/单日/缺失日期/日期倒挂）实测，逐项核对技术方案 7.6 与 10.3：

| 验收项 | 结果 |
| --- | --- |
| 成员标题行独立成行、不显示任务条 | 通过 |
| 每个任务独占一行，同成员同日任务不遮挡 | 通过 |
| 日期网格与任务条横向对齐（左边界=开始日） | 通过 |
| 左侧标题列与右侧任务行纵向对齐 | 通过 |
| 折叠/展开成员后其后的行不错位 | 通过（展开王五后新增 3 行，后续成员行位置正确） |
| 横向滚动时表头与任务条同步 | 通过 |
| 纵向滚动时表头吸顶、左列跟随同步 | 通过 |
| 跨月任务按时间窗裁剪、原始日期不变 | 通过（2026-09-25~10-06 的任务从窗口首日开始绘制） |
| 当日标记 | 通过（2026-10-09 红色虚线） |
| 缺失日期与日期倒挂的显式提示 | 通过（`仅截止日` / `无日期` / `日期倒挂` 标签，均不伪造任务条） |

### 5. 甘特图渲染路线评估

- 结论：**不采用 Frappe Gantt，改为项目内自研 SVG 渲染层**。
- 依据（源码级）：Frappe Gantt 1.2.2 的行高与纵坐标完全由任务下标决定（`src/bar.js` `compute_y()`：`y = header_height + padding + task._index * (height + padding)`），网格高度按 `(bar_height + padding) × 任务数` 计算（`src/index.js`），且库本身不提供左侧任务名列。
- 因此「成员标题行 + 变高行 + 左列固定 + 折叠展开」需要改动库源码（超出预设 100 行阈值）并叠加 hack 式 DOM/CSS 补丁，按预先锁定的决策规则切换到自研渲染层，未改动任何第三方源码。

### 6. 桌面端与凭据安全检查

- `dist/` 产物中未出现令牌值，也未出现 `PERSONAL_TOKEN` 字样（脚本比对）。
- 令牌仅在 `.env.local`（已 gitignore）与 Rust 进程内使用，前端不持有令牌。
- Tauri 桌面端构建与启动：`pnpm tauri:dev` 编译 353 个 crate 后成功启动（首次编译约 15 分钟，主要为 crates.io 索引拉取；增量编译 3.5 s）。
- 窗口加载验证：WebKit 网络进程与 Vite dev server（127.0.0.1:5183）建立连接，确认桌面窗口成功加载 PoC 页面。
- 端到端链路验证（`VITE_POC_AUTOLOAD=live` 验证钩子 + Rust 侧接口路径诊断日志）：

```text
[tapd_get] GET /workspaces/users      # 两个项目各一次，建立工号 -> 姓名索引
[tapd_get] GET /tasks/count
[tapd_get] GET /bugs/count
[tapd_get] GET /tasks
[tapd_get] GET /bugs
[tapd_get] GET /tasks/count
[tapd_get] GET /tasks
[tapd_get] GET /bugs/count
[tapd_get] GET /bugs
```

  该序列只有在「前端 invoke → Rust 命令 → TAPD HTTPS → JSON 解析 → 分页判断 → 下一请求」每一环都成功时才会出现，据此确认桌面端真实数据链路可用；每类工作项各拉取 1 页（窗口内 103/12 条，未触发翻页）。
- Rust 侧手工验证测试：`cd src-tauri && cargo test -- --ignored` 共 2 个用例通过（Bearer 认证、按项目拉取任务），断言只输出 status/info，不打印响应体中的凭据。
- 应用图标：首次编译因缺少 `src-tauri/icons/icon.png` 失败，已用 `pnpm tauri icon` 基于本项目自绘图标源生成完整图标集后通过。

## Issues

1. **已修复**：`minDateKey` 比较方向错误，任务条宽度会按整月绘制（`src/gantt/dateUtils.ts`）。
2. **需在阶段1 处理**：TAPD 无效令牌返回 422、越权项目返回 403，错误处理必须按状态码区分「凭据失效」与「项目无权限」，并把后者作为项目级失败上报，不能显示为空数据。
3. **需在阶段1 处理**：`owner` 字段为多人分号串，当前仅取第一个处理人归组；多人任务的分组策略需要产品确认。
4. **需在阶段1 处理**：TAPD 任务详情页 URL 规则（`/task/view/<id>`、`/bug/view/<id>`）尚未在登录态下人工核对。
5. **环境记录**：Rust 官方源下载极慢（约 2–8 MB/分钟），改用 USTC 镜像后约 40 秒完成安装；仓库未写入任何镜像配置。

## Not Tested

- Tauri 应用打包（`tauri build`）与 Windows/Linux 目标平台，属阶段4 范围。
- 操作系统凭据存储（Keychain）读写，属阶段1 范围。
- 大数据量下的滚动性能（窗口内数据量小：单项目最多 103 条），属阶段4 范围。
- 定时刷新、离线缓存、多用户并发，首版不要求。
- TAPD 令牌有效期与长期稳定性：文档未说明，仅记录「本次实测可读 tasks/bugs/workspaces/users」。
- 桌面窗口内的鼠标点击交互：当前开发二进制无 bundle id，自动化工具无法绑定窗口，因此「点击真实数据按钮」改用 `VITE_POC_AUTOLOAD=live` 验证钩子覆盖；界面上的手工点击仍建议由人工完成一次。

## Artifacts

- 方案：`artifacts/plan/20261009_2343_tapd-team-sight-phase0.md`
- 接口验证脚本：`scripts/verify-tapd.mjs`（只读；令牌不打印、不落盘）
- 关键代码：`src/gantt/dateUtils.ts`、`src/gantt/layout.ts`、`src/services/tapd/client.ts`、`src/services/tapd/mapper.ts`、`src/components/gantt/GanttBoard.vue`、`src-tauri/src/lib.rs`
- 证据日志：`/tmp/team-sight-logs/tapd-verification.json`（接口能力矩阵原始输出）

## 追加：知识提升校验（2026-10-10）

- 用户确认将阶段0 的候选知识提升为正式知识，已写入 `knowledge/`。
- 校验方式：解析 `knowledge/index.yaml` 与 3 个子索引，并逐个检查条目 `path` 指向的文件是否存在。
- 结果：根索引 3 个子索引全部存在；4 个知识条目全部指向有效文件，无失效引用。
- 候选生命周期：内容已全部提升，原候选文件 `artifacts/knowledge/20261010_tapd-api-and-gantt-事实候选.md` 已按 `rules/knowledge.md` 删除。
