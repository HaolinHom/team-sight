# 截止日决定周末加班测试报告

## Summary
根据用户确认修正此前纯非工作日才加班的默认规则：任务截止在非工作日时，工作日先按规定容量分配，余量均分到截止前末尾连续且未请假的非工作日；截止在工作日时跳过中间周末。

## Results
- 31个文件、281个前端用例通过。
- 周五至周日12h得到8/2/2；周五至周一12h得到8/0/0/4；仅周六周日12h得到6/6；周五至周六12h得到8/4。
- 固定工作日任务占满容量时，跨周末余量全部安排周末，无上限；长任务不自动安排中间周末。
- 切换查询窗口结果一致；工作日截止的未知任务不影响其他任务周末加班格的完整性。
- 原有实际不重复、多人、日历、已结束、缺日期、待确认范围与页面保活回归全部通过。
- Vue类型检查、Vite、Rust release及macOS应用打包通过；令牌明文审计和git diff --check通过。

## Issues
修复新增页面测试的get().exists()类型断言，最终检查通过。

## Not Tested
未重新读取真实TAPD周末加班样本或重启用户活动应用进行桌面核对。Windows端未验收。预计值以计算日及截至当天的实际记录为依据，不向过去日期补预计值。

## Assumptions
中间周末不自动推断加班；截止日在非工作日时仅使用截止前末尾连续的非工作日承接余量。日历覆盖优先于默认周末；成员整日请假仍不自动分配。

## Artifacts
日志：/tmp/team-sight-keepalive-deadline-overtime.log（最终__EXIT=0）。
测试：src/hours/statistics.spec.ts、src/pages/HoursPage.spec.ts。
产物：src-tauri/target/release/bundle/macos/TeamSight.app。
