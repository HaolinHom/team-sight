# 中国节假日及调休与永久缓存

> 验证及授权提升日期：2026-10-17。

## 已验证事实

- 配置 v3 以 `AppSettings.chinaCalendar` 保存总开关和年度缓存，旧 `hours.calendarOverrides` 被忽略，手动日期维护入口已移除。
- holiday-cn 数据文件以公告标题年份组织，可包含上一年实际日期。涉及 12 月须补查下一年文件，按文件年份升序合并、较后文件覆盖较早文件。来源 README 与日期合并测试确认该约定。
- 数据源为 jsDelivr 的 NateScarlet/holiday-cn master 年度 JSON，失败或格式无效时回退 GitHub Raw；`isOffDay` 取反得到 `working`。
- `src/calendar/chinaCalendar.ts` 是共享工作日规则；看板与工时 Worker 使用同一份可序列化日期映射，个人请假豁免独立生效。
- 年份缓存永久有效；只有用户点击年份标签才重新获取已有缓存。缺失年份首次自动获取，自动失败在当前运行期间不重复尝试，允许手动重试。
- 绿色标签表示有效数据已持久保存；网络或保存失败时，有旧缓存则保留绿色、原数据和原获取时间，无旧缓存则保持红色；错误独立显示。“已缓存”不表示最近一次刷新成功。
- 缓存写入和开关更新沿用 useSettings 串行队列，基于最新配置合并，不覆盖并发保存的其他年份或设置。
- 工时需要展示区间和预测完整有效任务区间的年度日历；规则改变仅重算已有 TAPD 快照，不改变 TAPD 查询身份。
- 关闭开关只停用规则，保留年度缓存；无有效缓存时按普通周历处理并提示受影响年份。次年补充文件获取失败不使本年缓存失效。

## 关键实现入口

- `src/calendar/chinaCalendar.ts`：年度数据校验、损坏缓存过滤、公告覆盖顺序、共享工作日函数与跨年加载范围。
- `src/composables/useChinaCalendar.ts`：共享年度请求合并、当前运行期间的自动尝试记录、刷新错误与降级提示。
- `src/services/chinaCalendar.ts`、`src-tauri/src/china_calendar.rs`：双源请求与校验；桌面命令仅接收年份，固定来源，阻塞 HTTP 通过 `spawn_blocking` 执行。
- `src/types/settings.ts`、`src/composables/useSettings.ts`：v3 配置和成功保存后提交状态的串行更新。
- `src/components/hours/ChinaCalendarSettings.vue`：原生状态按钮、请求期间禁用、缓存颜色与北京时间获取时间。
- `src/pages/BoardPage.vue`、`src/pages/HoursPage.vue`、`src/hours/statistics.ts`、`src/hours/workerProtocol.ts`：看板与工时规则接入、快照重算及可序列化日历传递。

## 验证证据与边界

- 数据源约定：[NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)。永久缓存与手动刷新策略是本项目约定。
- 359 项前端测试、8 项 Rust 测试及 macOS 生产包构建通过。
- 真实桌面下载 2026 年 39 条安排，验证重启复用缓存以及绿色标签手动刷新更新时间；验收后用户设置已恢复。
- 报告：`artifacts/report/20261017_1103_china-calendar_测试报告.md`。
- 真实断网桌面 UI 与完整键盘导航未完成；失败恢复由自动化测试覆盖。Windows/Linux 未验证。
- 提升时仅进行源码和已有报告对照，未重新运行上述测试或桌面验收。
