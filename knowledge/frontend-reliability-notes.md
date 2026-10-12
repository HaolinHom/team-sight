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

上述结论确认当前源码和模拟回归行为；本轮未执行真实TAPD或桌面端端到端验证。
