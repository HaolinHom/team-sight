# 中国节假日及调休测试报告

## Summary

对中国日历配置迁移、在线获取、永久缓存、可点击年份状态，以及看板/工时统一规则进行单元、组件、路由集成、构建和 macOS 桌面生产包验证。

## Results

- `pnpm test`：35 个测试文件、359 项用例全部通过。
- `pnpm build`：Vue/TypeScript 类型检查及 Vite 生产构建通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：8 项通过、2 项原有真实 TAPD 凭据测试跳过，无失败。
- `pnpm tauri build --bundles app`：生产应用构建成功，产物 `src-tauri/target/release/bundle/macos/TeamSight.app`，12.89 MiB。
- `git diff --check`：无差异格式错误。
- `pnpm verify:secrets`：扫描 3391 个文件，未发现令牌明文泄漏。

### 自动化场景

- v1/v2 配置升级为 v3；原手动日期不再生效，成员、项目、规定工时、请假豁免保留。
- 中国日历默认关闭；开关独立保存，失败恢复已确认状态，后续可重试。
- 未获取年份为红色，保存成功才变绿色；请求中禁用标签；绿色标签点击后强制刷新。
- 原生按钮语义、年份倒序、获取时间、错误提示；缓存写入失败不显示假成功。
- 缓存无有效期，跨重启/切页/重新启用复用；缺失年份自动获取一次，失败通过标签重试。
- 同年份并发请求合并，不同年份与开关串行合并保存；网络/保存失败保留旧缓存。
- 主源网络或格式失败回退 GitHub Raw；桌面请求只传年份，不传 TAPD 凭据。
- 日期校验、重复/无效日期、上一年日期及较后年份公告覆盖、12 月补查次年文件。
- 周中休假和周末补班同步作用于看板表头/背景及工时目标、分配、加班规则；个人请假优先。
- 预测完整任务区间跨年补齐、缺失年份降级提示、隐藏页面延后重算；开关/日历变化不重新请求 TAPD。
- Worker 日历规则传递与已有快照复用。

### 真实桌面生产包

- 从本次构建的绝对 `.app` 路径启动，确认新配置界面及红色“未获取”标签。
- 实际获取并持久缓存 2026 年 39 条安排；核对 `2026-10-01` 为休假、`2026-10-10` 为工作日，schemaVersion 为 3。
- 开关保存后界面勾选状态正确，绿色标签和北京时间获取时间可见。
- 重启后直接显示原缓存与原获取时间 `2026/10/17 11:11:12`；点击绿色标签后更新为 `2026/10/17 11:12:45`。
- 验收结束已停止测试应用，并按字节恢复验收前的用户 settings.json；未修改用户凭据。

## Issues

未发现已验证场景中的功能缺陷。直接启动的公网隔离进程无法被原生界面工具按 bundle id 绑定，因此该方式的断网 UI 验收未完成，未将其记为通过。

## Not Tested

- 真实断网下的完整桌面 UI 操作；网络失败、缓存保留与无缓存降级由自动化测试覆盖。
- 实际键盘 Tab/Enter 全流程；标签使用原生 button，组件测试确认按钮语义，桌面验证使用鼠标点击。
- Windows/Linux 桌面平台、DMG 打包和发布；本次仅构建 macOS `.app`。
- 未执行原有两项依赖真实 TAPD 凭据的 Rust ignored 测试。

## Artifacts

- 方案：`artifacts/plan/20261017_1103_china-calendar.md`。
- 前端测试：`artifacts/report/20261017_1103_china-calendar_tests.log`。
- 前端构建：`artifacts/report/20261017_1103_china-calendar_build.log`。
- Rust：`artifacts/report/20261017_1103_china-calendar_rust.log`。
- 桌面构建：`artifacts/report/20261017_1103_china-calendar_desktop-build.log`。
- 桌面取证：`artifacts/report/20261017_1103_china-calendar_desktop-evidence.json`。
- 隔离进程诊断：`artifacts/report/20261017_1103_china-calendar_offline.log`（不作为断网 UI 验证通过的证据）。
- 差异检查：`artifacts/report/20261017_1103_china-calendar_diff-check.log`。
- 凭据扫描：`artifacts/report/20261017_1103_china-calendar_secrets.log`。
