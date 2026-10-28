# 知识候选：成员请假配置、目标扣减与原生日期弹窗

建议提升目标：`knowledge/frontend-reliability-notes.md`（请假配置与统计）；`knowledge/frontend-testing-notes.md`（原生dialog测试适配）。需用户明确确认后才能提升，本次不修改正式知识。

## 已验证事实

- `HoursSettings.exemptions`以成员工号和日期标识一条记录，新增必填数值`hours`，必须是大于0的有限数；缺失或损坏条目在读取时过滤，重复成员日期只保留首条，保存时拒绝重复。
- 当前用户未配置过旧请假记录，未实现缺失hours的历史迁移。新记录固定默认8h，不跟随每日规定工时。
- 工作日目标为`max(dailyRequiredHours - hours, 0)`，非工作日仍为0；统计中的`DailyHours.leaveHours`单独承载请假工时，实际填报保持原值。单日/截止日超额分配规则保持原逻辑；非工作日有个人请假时不参与末尾休息日加班。
- `LeaveCalendar`只通过`update:modelValue`上报草稿。日历确认后仍需`HoursSettingsCard`统一保存；失败恢复已保存草稿。成功后工时页复用Worker快照，保活返回时重算，请假记录不进入TAPD查询身份。
- 日期键按北京时间选取今天，月份网格按UTC运算，避免宿主时区影响。日历展示顺序按`AppSettings.members`解析。
- 原生`dialog.showModal()`在macOS生产WebView可用；Esc由cancel事件处理，关闭后恢复日期按钮焦点。当前jsdom测试环境没有showModal/close，需要在测试内定义方法；该模拟不能替代真实桌面模态与持久化验收。

## 证据与边界

- 386项前端回归、类型检查、Vite及macOS生产构建通过；最终图例文字调整后41项工时页回归和生产构建通过。
- macOS生产应用实际验证多成员、8h默认、小数、Esc取消、日历展示、统一保存、重启读取和真实工时页目标。
- 详见`artifacts/report/20261019_leave-calendar_测试报告.md`。Windows/Linux未实测；保存失败和查询次数由模拟/路由集成测试覆盖。
