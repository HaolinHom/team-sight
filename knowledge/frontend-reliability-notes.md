# 前端异步数据与配置一致性

> 验证日期：2026-10-12｜验证方式：四项可靠性修复源码核对及单元、组件回归测试（160个用例通过）。

## 已验证模式与调用契约

- 异步刷新采用递增请求序号。成功、catch和finally均检查是否仍是当前请求，防止旧响应覆盖错误、数据和加载状态。记录数据加载范围；页面只渲染与当前筛选范围相符的数据。同范围全部失败保留旧数据，但标注为旧数据，不更新最后成功刷新时间。
- ScheduleFetchResult必须提供status（complete/partial/failed）、errors和warnings。聚合状态根据工作项源成功/失败判断，不能用tasks.length判断：成功空结果也是成功。
- 50页、每页200条为分页安全边界。已知count确认收敛时返回完整结果；触顶仍无法确认完整时fetchWorkspaceItems抛出TapdTruncationError，内含已拉取tasks。聚合层保留这些任务、产生warnings，标记partial；warnings不能作为接口失败计数。
- useSettings更新在串行队列内基于最新已保存配置计算；saveSettings成功后提交共享状态。保存失败通过saveError反馈，页面事件不会收到未处理拒绝，失败不能阻断下一次写入。新增项目失败返回false，新增成员失败返回0。
- 原生checkbox/color控件会先改变DOM值；采用成功后提交模式时，事件处理需恢复确认值，避免保存失败后控件视觉与Vue状态不一致。页面组件测试已覆盖该行为。

## 证据

src/composables/useSchedule.spec.ts、src/composables/useSettings.spec.ts、src/services/tapd/client.spec.ts、src/pages/BoardPage.spec.ts、src/pages/SettingsPage.spec.ts。
报告：artifacts/report/20261012_2243_reliability-fixes_测试报告.md。

## 验证边界

上述结论确认当前源码和模拟回归行为；2026-10-12 的验证未执行真实TAPD或桌面端端到端验证；后续补充的验证范围见各节。

## Worker 计算与短期查询缓存

> 验证日期：2026-10-14；2026-10-16 提升并核对当前实现。

- 工时 Worker 为独立 module bundle；快照通过 structured clone 传入一次，规则变化复用 Worker 中的快照重算。结果通过 Vue shallowRef 提交，快照身份及规则版本参与过期校验。仅将快照身份存在非响应式变量中，可能使 computed 因短路而未跟踪结果依赖。
- Worker error／messageerror 先解除 pending，再终止 Worker 并回报真实错误；否则取消操作产生的 AbortError 会掩盖原失败。
- 短期缓存只保留完整查询及每个响应的原始获取时间，聚合刷新时间取最早值，不能使用本次聚合开始时间冒充缓存数据时间。凭据、项目、成员上下文进入缓存键，手动刷新强制失效。
- 当前缓存 TTL 为 1 分钟；最多 512 项／40000 行，单响应超过 2000 行不缓存。它与路由页面保活是不同层次：缓存过期本身不触发保活页面重新加载。

证据：src/hours/workerClient.ts、src/hours/hours.worker.ts、src/pages/HoursPage.vue、src/services/tapd/hoursCache.ts、src/services/tapd/hours.ts；artifacts/report/20261014_1400_hours-performance_测试报告.md。生产 Worker 执行及真实 TAPD 缓存已验证，桌面精确输入延迟未测量。

## 路由保活与异步生命周期

> 验证日期：2026-10-14；2026-10-16 提升并核对当前实现。

- RouterView 插槽内的 KeepAlive 按组件名称仅缓存 BoardPage、HoursPage，稳定 route.name 作为键；设置页正常卸载。
- 停用不等于卸载，页面 watch 仍会响应共享配置变化；通过激活状态门控配置驱动加载与规则重算，隐藏期间的多次变更在返回时按最新配置合并处理。
- 已经启动的加载与 Worker 可在停用期间完成；查询键、计算键阻止与当前来源不匹配的旧响应成为有效展示。首次加载完成时即使隐藏，配置未变化也可开始后台计算。
- 激活后 nextTick 恢复滚动并重新测量工时虚拟矩阵；停用断开 ResizeObserver，真正卸载才取消请求、终止 Worker，并清理定时器与监听器。

证据：src/app/App.vue、src/pages/BoardPage.vue、src/pages/HoursPage.vue；src/app/App.spec.ts 使用真实 memory Router 的回归，以及 src/pages/BoardPage.spec.ts；artifacts/report/20261014_1442_route-keepalive_测试报告.md 包含前端测试、构建与 macOS 桌面切页验收。

## 成员展示顺序与查询身份

> 验证及授权提升日期：2026-10-16。

- `AppSettings.members` 数组顺序统一决定设置、看板与工时的成员展示顺序，无单独排序字段或配置迁移；新增成员追加到末尾。
- `useSettings.moveMember(staffId, targetStaffId, placement)` 以工号指定 before／after 相对位置，在现有 persist 串行队列内计算，保存成功才提交共享状态。无效成员、自身或位置不变不写入。
- 真实看板页面传入 `memberOrder` 成员键列表到 GanttBoard 和布局层；未传时保留姓名排序，未指定位置的成员排在已指定成员之后，未分配成员仍在最后。不新增无任务成员组，组内任务排序及多负责人归属保持原逻辑。
- 工时 `calculateHours` 保留输入 members 顺序，筛选与虚拟矩阵沿用结果顺序，不按不足天数重排。
- 看板 `sourceKey` 不含成员顺序；工时 `hoursQueryKey` 将成员工号排序后生成查询键。展示顺序与数据查询身份分开，因此仅调序不重新请求 TAPD。工时 `calculationKey` 包含原顺序 members，返回保活页面后复用已有 Worker 快照重算。

证据：src/composables/useSettings.ts、src/gantt/layout.ts、src/hours/statistics.ts、src/pages/BoardPage.vue、src/pages/HoursPage.vue、src/composables/useHours.ts、src/app/App.spec.ts；artifacts/report/20261016_1530_member-order_测试报告.md（317 项前端测试及生产构建），artifacts/report/20261016_1553_member-drag-fix_测试报告.md（后续 321 项回归及 macOS 拖拽持久化验收）。跨页无新增请求与状态保留由 memory Router 集成测试验证，未对桌面 TAPD 请求单独抓包。
