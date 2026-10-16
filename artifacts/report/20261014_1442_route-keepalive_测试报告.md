# 看板与工时页面路由保活测试报告

## Summary
2026-10-14 按已确认方案实现 Vue KeepAlive 页面保活、激活刷新门控、数据来源保护、后台工作保留和滚动恢复。仅保活 BoardPage 与 HoursPage，设置页保持正常卸载。

## Results
- 前端回归：31 个测试文件、251 个用例通过。新增 App.spec.ts 10 项真实 memory Router 测试。
- 已验证反复切页保留组件 DOM、任务／工时数据、成员筛选、详情与滚动；同日超过缓存期限返回不请求、不重算。
- 看板加载、工时加载及 Worker 计算隐藏期间继续完成，返回不重复启动。
- 隐藏期间多次修改项目配置不请求，返回仅按最新配置更新一次；工时目标变化延后本地重算，项目名称和颜色更新不重新取数。
- 成员变化只重拉工时，看板复用任务；凭据清除隐藏旧数据，旧账号响应不作为新账号结果展示；跨日及手动刷新行为通过。
- 卸载取消计算资源；既有失败、范围不匹配、旧数据标注测试全部通过。
- pnpm build：Vue 类型检查与 Vite 生产构建通过。
- pnpm tauri build --bundles app：macOS release 与应用打包通过。
- pnpm verify:secrets 无令牌明文泄漏；git diff --check 通过。
- 新构建 macOS 桌面实测：看板 8 项目、6 成员、475 任务，离开前折叠成员，往返后仍为折叠状态，最后成功刷新时间保持不变。
- 工时在成员目录 5／8 时离开到设置，后台完成后返回直接展示矩阵；打开工时明细再切看板并返回，明细与最后成功加载时间保持不变。

## Issues
未发现阻止交付的问题。旧看板组件测试未卸载页面，新增共享配置 watch 后造成跨用例单次 mock 被消费，已补充自动卸载。工时停用时保留正在进行的计算，配置变化只延后新工作。

## Not Tested
Windows 原生端未验收；本轮未修改真实项目、成员、凭据或工时规则，配置变化和跨日通过模拟回归验证。桌面接口请求数量没有网络抓包量化，重复请求与计算次数由真实 Router 集成测试断言。保活仅限应用运行期间，不跨重启保存。

## Artifacts
- 方案：../plan/20261014_route-keepalive.md
- 测试：src/app/App.spec.ts，src/pages/BoardPage.spec.ts，既有页面与组合函数回归。
- 完整测试／类型检查／构建／审计日志：/tmp/team-sight-keepalive-delivery.log（__EXIT=0）。
- macOS 打包日志：/tmp/team-sight-keepalive-final.log（__EXIT=0）。
- 桌面启动日志：/tmp/team-sight-keepalive-desktop.log。
- 产物：src-tauri/target/release/bundle/macos/TeamSight.app。
