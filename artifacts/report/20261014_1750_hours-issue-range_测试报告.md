# 工时异常日期范围测试报告

## Summary
修复无有效排期区间的任务异常传播至所有未来工作日的问题；将异常数量明确为当日待确认原因数，避免误解成当天贡献任务数。

## Results
- 31个前端测试文件、267个用例通过。
- 四项缺开始／截止／全部日期或倒置日期任务保留待安排，已知4.5h及后续0h日期不再重复标记这些异常。
- 四项完整排期但缺预估任务只在自身区间显示四个原因，区间外0h正常判定当前排期不足。
- 指定日期的接口失败仍产生待确认，不因已知0h错误消除完整性保护。
- 页面验证后续0h日期无重复原因，成员待安排仍可查看四个任务及缺日期原因。
- 休息日、已达标含异常、路由保活等既有回归通过。
- Vue类型检查、Vite、Rust release与macOS打包通过；令牌审计和git diff --check通过。

## Issues
未发现阻止交付的问题。该改动仅收窄可定位任务异常的日期影响，不改变实际工时和预计分配数值。

## Not Tested
截图任务的真实TAPD原始日期和预估未重新读取，不能仅凭截图断定四项任务具体缺哪个字段；本轮通过模拟用例验证缺日期传播与完整区间的区分。未重启用户活动应用，Windows端未验收。

## Artifacts
日志：/tmp/team-sight-keepalive-issue-range.log（__EXIT=0）。
测试：src/hours/statistics.spec.ts、src/pages/HoursPage.spec.ts。
产物：src-tauri/target/release/bundle/macos/TeamSight.app。
