# 展示成员拖拽排序修复测试报告

## Summary

修复设置页在 macOS Tauri 桌面端拖拽成员后不更新顺序的问题。将 HTML5 drag/drop 改为 Pointer Events 与 pointer capture：按下手柄后捕获指针，移动时按实际坐标提示插入位置，释放时重新命中目标并调用原有串行保存方法。

验证日期：2026-10-16。测试与生产构建均在 iTerm 中执行，桌面验收使用本次生成的 TeamSight.app。

## Results

| 对照项 | 结果 |
| --- | --- |
| 全量前端回归 `pnpm test` | 31 个文件、321 项用例全部通过，包含设置页 11 项用例 |
| 生产构建 `pnpm tauri build --bundles app` | 类型检查、Vite 构建、Rust release 编译与 macOS app 打包成功 |
| `git diff --check` | 通过 |
| 拖拽向前／向后与目标上／下半区 | 组件测试检查插入提示及保存后的成员工号顺序；桌面实际交换前两位成功 |
| 跨多行拖动 | 桌面实际将第 6 位拖到第 3 位之前，再拖回末尾成功 |
| 持久化 | 桌面拖拽交换前两位后退出应用并重新启动，设置页保留交换后的顺序 |
| 列表外释放 | 桌面实际拖到列表外松开，顺序不变；组件测试同时覆盖自身放置和轻微移动 |
| 取消与指针隔离 | 组件测试覆盖 Escape、pointercancel、lostpointercapture、其他 pointerId 不提交及卸载清理 |
| 保存状态与失败恢复 | 组件测试确认保存期间禁用排序、成功前维持已确认顺序、失败提示并允许后续重试 |
| 前移／后移按钮 | 桌面实际点击后移及前移均生效，首位前移与末位后移禁用 |
| 跨页顺序及请求次数 | 全量回归包含 App 保活集成测试，确认排序后看板与工时更新、保留筛选详情及折叠状态且不重新取数 |

桌面测试使用原有 6 名成员。最终已恢复为：洪浩林、刘思琪、林曈、柯礼淼、龙祖鹏、廖和福；搜索框为空，验收包已关闭，未进入全屏。

## Issues

- 原 HTML5 拖放实现通过模拟事件测试，但未覆盖桌面 WebView 实际输入链路，未能发现拖动无法提交的问题。本次改用不依赖原生拖放流程的指针捕获，并以最终桌面包实际验证。
- 改造测试时最初出现 6 项事件构造错误：Vue Test Utils `trigger` 尝试覆盖 PointerEvent 从 MouseEvent 继承的只读属性。测试已改为构造 MouseEvent、补充 pointerId 并派发，最终全部通过。
- 最终验证未发现遗留问题。

## Not Tested

- 未在 Windows、Linux、触摸屏或触控笔设备上实测。
- Escape 与原生指针取消依靠组件测试覆盖；真实磁盘写入失败通过命令 mock 验证，未破坏本机配置文件权限。
- 本轮桌面实测聚焦拖拽和持久化；跨页无额外 TAPD 请求由自动化集成测试断言，未单独抓取桌面网络请求。

## Artifacts

- 实现：`src/pages/SettingsPage.vue`
- 回归：`src/pages/SettingsPage.spec.ts`
- 日志：`artifacts/report/20261016_1553_member-drag-fix.log`
- 桌面产物：`src-tauri/target/release/bundle/macos/TeamSight.app`
- 执行入口：`bash scripts/iterm-run.sh /tmp/team-sight-drag-pointer-final.log 'pnpm test && pnpm tauri build --bundles app && git diff --check'`
- 原功能方案：`artifacts/plan/20261016_1530_member-order.md`
