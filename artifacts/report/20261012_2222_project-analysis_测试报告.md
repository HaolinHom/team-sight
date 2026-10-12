# TeamSight 项目分析测试报告

## Summary

本次对当前项目的源码、技术方案、用户手册、相关知识与历史阶段4报告进行分析，评估可靠性、使用体验与后续迭代价值。未修改业务源码，不输出实施方案。

执行已有前端测试与生产构建；在仓库外通过临时脚本将原始 TypeScript 转译为 CommonJS，注入模拟服务，验证刷新竞态、分页上限和配置保存失败。模拟验证不调用真实 TAPD，也不读写真实应用配置或令牌。

## Results

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| pnpm test | 18 个测试文件、135 个用例全部通过 | /tmp/team-sight-analysis-checks.log |
| pnpm build | vue-tsc 类型检查与 Vite 生产构建通过 | 同上；日志 __EXIT=0 |
| 并行刷新响应乱序 | 已复现旧月份覆盖新月份 | /tmp/team-sight-race-probe.log |
| 并行刷新加载状态 | 已复现旧请求未完成时 loading 已置 false | 同上 |
| 分页触顶 | count=10001，50 页共返回10000条，无截断错误 | /tmp/team-sight-edge-probe.log |
| 配置保存失败 | 保存 promise 拒绝后，内存启用状态仍已改变 | 同上；日志 __EXIT=0 |
| Rust/前端凭据字段契约 | 静态确认 masked_hint 与 maskedHint 不一致，未看到重命名或映射 | src-tauri/src/lib.rs:33；src/services/credentials.ts:44 |
| 当前性能边界 | 本轮2000条布局回归测试通过；历史阶段4有浏览器首屏和滚动实测 | src/gantt/layout.performance.spec.ts；历史阶段4报告 |

测试通过仅代表已有覆盖通过，不代表上述边界问题不存在。

## Issues

### 优先处理：数据可信度与状态一致性

1. **刷新竞态**：useSchedule.refresh 没有请求序号、取消或提交条件。后发请求先完成后，先发请求仍能写入 liveTasks/errors/lastLoadedAt；任何请求的 finally 都会将 loading 置 false。BoardPage 的日期 watch 会在加载中继续触发刷新。建议只提交当前最新请求结果，并将已加载的数据范围与筛选范围关联；旧数据保留时标注其范围和陈旧状态。来源：src/composables/useSchedule.ts:18、src/pages/BoardPage.vue。
2. **数据完整性缺少显式状态**：client 的 MAX_PAGES=50，PAGE_SIZE=200。达到上限即返回 collected，没有警告。全部工作项源失败时聚合仍返回 tasks=[] 与 errors，useSchedule 仍记录刷新时间；页面统一显示“部分项目加载失败”，不能准确区分全部失败。建议暴露完整/部分/失败/截断状态及成功来源数量，保留安全分页上限。来源：src/services/tapd/client.ts:153、src/composables/useSchedule.ts:26、src/pages/BoardPage.vue:200。
3. **配置保存与界面状态不同步**：useSettings 先修改共享内存再 await persist，写入失败没有回滚；设置页多处直接调用 store 方法，没有保存失败的页面反馈。建议保存成功后提交状态，或失败回滚；写入串行化并展示保存失败提示。来源：src/composables/useSettings.ts:52、src/pages/SettingsPage.vue。
4. **凭据跨语言契约不一致**：Rust CredentialStatus 默认序列化 masked_hint，TypeScript 接口使用 maskedHint，loadCredentialStatus 直接返回 invoke 结果。会导致桌面端令牌掩码提示取不到值。建议统一字段命名或映射，补真实序列化形态的契约测试。来源：src-tauri/src/lib.rs:33、src/services/credentials.ts:44。

### 后续工程优化

- **请求层**：Rust tapd_get 使用同步 ureq 请求；后续评估移至异步命令与阻塞工作线程，测量慢请求期间的桌面响应。HTTP status 在 Rust 中被丢弃，前端将响应体 status 用作错误状态；建议区分 HTTP 与业务状态，完善429/Retry-After与非JSON响应处理。本次没有真实故障注入，未确认实际429响应结构或桌面阻塞现象。
- **减少重复拉取**：目前每次刷新先加载所有启用项目的成员目录，再加载任务与缺陷。可先缓存变化频率较低的成员目录，随后按项目、类型、时间范围缓存数据；必须标明最后成功时间、缓存来源和失败状态。
- **凭据与分发**：当前令牌明文保存在0600文件；系统钥匙串已是既定后续方向。跨平台发布需要验证Windows存储/权限与打包，macOS签名、公证与更新机制取决于团队分发需求。当前Tauri bundle targets为app/dmg，不能仅凭源码断言Windows已经可打包。
- **持续集成与契约测试**：仓库未配置CI。优先自动执行pnpm test、pnpm build、Rust非真实凭据测试，补充乱序刷新、保存失败、分页触顶及Tauri命令契约覆盖。真实TAPD验证保留人工或明确授权触发。
- **长期开启的看板**：BoardPage 的 today 在 setup 时固定；应用跨午夜后当天标记不会自动更新。顶部“任务行”使用任务数量，而多人任务实际拆成多行，建议区分工作项数与实际行数。
- **文档一致性**：原技术方案选型表仍写Frappe Gantt，当前实现和正式知识已确定自研SVG；需要明确原设计与最终实现的区别。

## 产品迭代建议

以下为方向评估，不是已确认需求或实施计划。

| 方向 | 用户价值 | 约束与建议 |
| --- | --- | --- |
| 逾期/即将到期视图 | 快速找到需要跟进的工作项 | 已加载窗口只能覆盖部分逾期任务，跨历史窗口统计需独立查询；完成语义需可配置 |
| 成员排期重叠提示 | 快速发现同一成员同日参与多个任务 | 只表示时间重叠，不能直接推断超负荷 |
| 搜索、保存视图、全部折叠/展开 | 减少日常查找和重复筛选 | 成员/状态选项变化时清理失效选择；视图不包含令牌 |
| 未排期工作项按需入口 | 暴露甘特图之外的排期盲区 | TAPD范围查询排除缺日期任务，null查询量大；按需、分页加载，不加入每次首屏刷新 |
| 周级概览、日期缩放与定位今天 | 提高长时间范围的阅读效率 | 继续复用单一布局坐标来源 |
| 导出CSV或会议快照 | 支持周会与跨团队沟通 | 标明筛选、时间范围、抓取时间和完整性；导出排除凭据 |
| 负载热力图/容量分析 | 辅助人员安排 | 先定义工时单位、工作日、成员容量、多负责人分摊；跨项目原始effort不能直接相加 |

建议优先顺序：先保证数据可信度，再提升查找与风险发现效率，团队扩大使用后投入发布与分发能力。

不建议当前优先更换甘特图库、引入大型状态管理或实现虚拟滚动：现有边界清楚，2000条回归与历史浏览器实测支持保留自研SVG；如果真实数据、多负责人拆行或更长窗口导致响应下降，应先测量实际渲染规模再决定。

## Not Tested

- 本轮未连接真实TAPD，未运行verify:tapd，也未读取.env.local内容。
- 未重跑Rust测试、桌面打包、签名、公证、Windows运行与端到端界面测试。
- 未重新进行浏览器/WebView首屏、滚动、内存性能测量；引用历史测量不代表本轮验证。
- 模拟探针确认模块行为，不替代完整桌面交互或真实接口验证。

## Artifacts

- 临时日志：/tmp/team-sight-analysis-checks.log、/tmp/team-sight-race-probe.log、/tmp/team-sight-edge-probe.log。
- 临时模拟脚本：/tmp/team-sight-race-probe.cjs、/tmp/team-sight-edge-probe.cjs；未加入仓库。
- 参考历史报告：artifacts/report/20261011_2210_tapd-team-sight-phase4_测试报告.md。
- 参考知识：TAPD查询约束、自研SVG选型、前端测试接入、本地工具链与凭据。
- 不生成知识候选：本次结论以局部源码缺陷和未确认产品方向为主，没有需要提升的新增通用实现模式。
