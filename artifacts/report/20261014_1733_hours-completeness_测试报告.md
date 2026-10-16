# 工时达标与完整性分开展示测试报告

## Summary
针对已知预计工时达到目标仍被待确认覆盖的问题，分开展示工时状态与完整性。达到目标时保留达标／预计充足／超额；原因列表独立保留。未达到目标且不完整时维持待确认，避免确定不足结论。

## Results
- 31 个前端测试文件、257 个用例全部通过。
- 新增统计测试覆盖历史实际8h含异常、今天实际2h加分配6h、已知预计8h加未知任务、超额含异常。原有未知不足不计入不足天数测试通过。
- 新增页面测试验证预计充足和部分数据待确认同时出现、原因数量、待确认汇总与筛选保留这些日期、侧栏解释，以及今天实际8h显示实际已达标。
- 当前每日结果 reasons 独立表示完整性，工时状态不再由异常无条件覆盖；查询、实际记录与分配数值保持原逻辑。
- pnpm tauri build --bundles app 通过，包括 Vue 类型检查、Vite、Rust release 与 macOS 打包。
- pnpm verify:secrets 无令牌明文泄漏；git diff --check 通过。

## Issues
未发现阻止交付的问题。数据不完整时的预计充足只表达当前已知合计达到目标，侧栏明确提示预计分配仍可能随数据补全调整。

## Not Tested
本轮未重启用户活动应用进行真实 TAPD 桌面验收；截图对应实际数据结构由统计和组件测试复现。Windows 原生端未验收。应用重启后加载新版本。

## Artifacts
- 完整日志：/tmp/team-sight-keepalive-completeness.log（__EXIT=0）。
- src/hours/statistics.spec.ts，src/pages/HoursPage.spec.ts。
- macOS 产物：src-tauri/target/release/bundle/macos/TeamSight.app。
