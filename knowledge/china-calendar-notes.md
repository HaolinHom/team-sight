# 中国节假日及调休与年度缓存

> 适用版本：MCP 0.3.4／配置 schema v6。2026-11-17 复核首次安装默认开启及已有配置兼容；年度缓存、快照与展示规则沿用此前实现。默认开启的取数／失败路径已用固定响应验证，本次知识提升仅做静态对照，未在线验证外部日历源。

## 数据与工作日规则

- 配置以 `chinaCalendar.enabled` 和 `chinaCalendar.years` 保存开关及年度缓存。0.3.4 新数据库默认开启、年度缓存为空；此前默认关闭的已有对象配置保持关闭，旧配置缺失日历时也不自动开启。关闭只停用日历覆盖，保留缓存；当前工时规则不扣请假。
- 来源为 NateScarlet/holiday-cn 的 jsDelivr master 年度 JSON，网络或校验失败时回退 GitHub Raw。服务端仅接受年份并访问固定来源；`isOffDay` 取反得到 `working`。
- 校验年份、非空日期和公告列表、日期合法性及重复日期。年度文件按公告年份组织，允许包含上一年的日期；涉及 12 月时额外加载次年来源，合并时按来源年份升序，较后来源覆盖较早来源。
- `mergeCalendar` 与 `isWorkingDay` 为共享规则；没有日期覆盖时使用普通周历。损坏年度缓存按未获取处理，不影响其他有效年份。

## 自动获取、刷新与保存

- 年度缓存没有 TTL。启用日历时，分析先检查展示范围，再补齐完整任务分配区间所需来源。
- 已有缓存不自动刷新；缺失来源在当前服务进程中自动尝试一次，失败后不自动重复。设置页“刷新数据”或 `teamsight_refresh_calendar` 可显式强制重试。
- 刷新经服务端读取最新设置并校验 revision，成功持久化后才发布新缓存；失败保留旧值和原 fetchedAt，显式刷新失败返回 `CALENDAR_REFRESH_FAILED`。
- 设置卡片的开关作为草稿通过局部保存提交；年度刷新是立即生效的独立动作。卡片操作会处理未保存草稿，刷新后重新读取正式设置。
- 默认开启不等于首次安装即预置年度数据，也不表示外部来源已经可用。用户主动关闭并保存后，重启和重开卡片不会再次开启；新旧配置边界见[配置规则](teamsight-mcp-config-scope.md)。
- 缺少必要来源时，分析标记日历不完整，记录限制及受影响日期原因；对应不足状态改为 unknown，不能将普通周历结果当作已确认的节假日目标。

## 分析快照与甘特图日期

- `TeamAnalysis.calendar?: WorkingCalendar` 保存实际参与计算的日历中、分析日期范围内的覆盖。空对象表示没有日期覆盖，按普通周历回退；字段缺失表示旧分析。空对象不能证明中国日历来源完整，仍须结合分析 status、limitations 与每日 reasons。
- `teamsight_read_analysis` 按视图日期裁剪日历覆盖，各成员／任务分页使用同一快照依据；模拟分析通过深拷贝继承基准日历，不使用当前设置替换。
- 界面与 SVG／PNG／HTML 导出统一使用 `isWorkingDay`：工作日节假日及普通周末按休息日着色，周末调休按工作日显示。每日目标工时允许为 0，不能以目标值推断是否休息日。
- 缺少 calendar 字段的旧分析按普通周历显示，0.3.2 卡片不再展示重新分析提示；静态导出保留既有旧日历提示。读取时不在线补查、不改写历史日历依据。日历开关和缺失来源规则仍按上文处理，不因界面着色额外开启或刷新日历。
- 日期底色、成员行零工时隐藏及模式渐变见[甘特图交互](mcp-gantt-interaction-notes.md)。

## 实现与验证边界

- [0.3.4 实施报告](../artifacts/report/20261117_teamsight034-default-settings_测试报告.md)及[业务回归](../apps/server/test/business.test.mjs)记录默认开启下的固定年度响应、持久化与重启复用、节假日／调休目标，以及来源失败的 partial／unknown 处理；不代表真实公网日历源验收。
- [分析类型](../packages/core/src/analysis.ts)声明可选日历快照；[分析读取](../apps/server/src/business-tools.ts)返回视图区间覆盖。
- [2026-11-07 实施报告](../artifacts/report/20261107_甘特图节假日与模式切换_测试报告.md)记录隔离日历 fixture、快照／分页／模拟回归及 Chrome 浏览器验收；未完成原生 Apps、Safari／Firefox 和其他平台验收。
- [0.3.2 展示精简报告](../artifacts/report/20261107_甘特图展示精简与MCP032_测试报告.md)验证卡片隐藏旧日历提示但仍传递日历、按保存依据着色；本次精简不改变分析完整性和静态导出。
- [core 日历](../packages/core/src/calendar.ts)：校验、来源覆盖、工作日判断与跨年范围。
- [分析及刷新](../apps/server/src/business.ts)：固定双源、进程尝试记录、持久化及不完整状态。
- [设置卡片](../apps/mcp-ui/src/FormalSettings.vue)、[日历工具](../apps/server/src/business-tools.ts)：手动刷新和局部保存入口。
- [0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)保留版本验收范围；不沿用旧 Tauri 的绿色年份标签、Rust 下载、Worker 或 useSettings 队列说明。
