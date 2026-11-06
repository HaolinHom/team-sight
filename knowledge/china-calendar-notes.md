# 中国节假日及调休与年度缓存

> 适用版本：MCP 0.3.0／配置 schema v6。2026-11-06 按当前源码复核；下述为实现契约，本轮未访问外部日历源。

## 数据与工作日规则

- 配置以 `chinaCalendar.enabled` 和 `chinaCalendar.years` 保存开关及年度缓存，默认关闭。关闭只停用日历覆盖，保留缓存；当前工时规则不扣请假。
- 来源为 NateScarlet/holiday-cn 的 jsDelivr master 年度 JSON，网络或校验失败时回退 GitHub Raw。服务端仅接受年份并访问固定来源；`isOffDay` 取反得到 `working`。
- 校验年份、非空日期和公告列表、日期合法性及重复日期。年度文件按公告年份组织，允许包含上一年的日期；涉及 12 月时额外加载次年来源，合并时按来源年份升序，较后来源覆盖较早来源。
- `mergeCalendar` 与 `isWorkingDay` 为共享规则；没有日期覆盖时使用普通周历。损坏年度缓存按未获取处理，不影响其他有效年份。

## 自动获取、刷新与保存

- 年度缓存没有 TTL。启用日历时，分析先检查展示范围，再补齐完整任务分配区间所需来源。
- 已有缓存不自动刷新；缺失来源在当前服务进程中自动尝试一次，失败后不自动重复。设置页“刷新数据”或 `teamsight_refresh_calendar` 可显式强制重试。
- 刷新经服务端读取最新设置并校验 revision，成功持久化后才发布新缓存；失败保留旧值和原 fetchedAt，显式刷新失败返回 `CALENDAR_REFRESH_FAILED`。
- 设置卡片的开关作为草稿通过局部保存提交；年度刷新是立即生效的独立动作。卡片操作会处理未保存草稿，刷新后重新读取正式设置。
- 缺少必要来源时，分析标记日历不完整，记录限制及受影响日期原因；对应不足状态改为 unknown，不能将普通周历结果当作已确认的节假日目标。

## 实现与验证边界

- [core 日历](../packages/core/src/calendar.ts)：校验、来源覆盖、工作日判断与跨年范围。
- [分析及刷新](../apps/server/src/business.ts)：固定双源、进程尝试记录、持久化及不完整状态。
- [设置卡片](../apps/mcp-ui/src/FormalSettings.vue)、[日历工具](../apps/server/src/business-tools.ts)：手动刷新和局部保存入口。
- [0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)保留版本验收范围；不沿用旧 Tauri 的绿色年份标签、Rust 下载、Worker 或 useSettings 队列说明。
