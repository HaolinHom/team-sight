# 看板四项可靠性修复测试报告

## Summary

按已确认的四项可靠性修复范围实施：刷新竞态、分页触顶静默截断、配置写入失败状态不一致、全部与部分加载失败混用。

新增25个回归用例；未修改Rust、凭据存储或外部接口，只对前端数据加载、配置提交、页面反馈及测试作必要调整。

## Results

| 验证 | 结果 |
| --- | --- |
| pnpm test | 20个文件、160个用例全部通过（原135个，新增25个） |
| pnpm build | TypeScript检查与Vite生产构建通过 |
| git diff --check | 通过，整组检查日志退出码0 |
| 旧请求先结束 | 不提交旧数据或时间，不提前结束最新请求加载状态 |
| 最新请求先结束，旧请求随后成功/失败 | 旧请求不能覆盖任务、错误或最后成功刷新时间 |
| 全部失败（结构化结果/异常） | 保留上次任务、时间和范围，状态为failed |
| 成功空数据 | 正常更新加载范围与时间，状态为complete |
| 超过10000条/无法获取count且50页满页 | 明确提示截断，保留10000条结果，聚合状态partial |
| count确认刚好10000条 | 完整结果，不误报截断 |
| 单独调用fetchWorkspaceItems触顶 | 抛出携带部分任务的TapdTruncationError |
| 全部数据源失败/一个成功空源 | 分别判为failed/partial，不用任务数推断成功与否 |
| 项目增改删、成员增删保存失败 | 已确认内存配置不改变，错误被捕获并展示 |
| 连续配置更新 | 串行写入，各次更新基于最新已保存结果 |
| 首次失败后继续保存 | 后续操作可成功，成功后清除保存错误 |
| 设置页启用/颜色控件写入失败 | 控件恢复已保存状态，展示可读错误提示 |
| 看板首次全部失败 | 不显示正常空状态，也不显示成功刷新时间 |
| 同范围刷新失败 | 保留旧任务并明确提示旧数据 |
| 切换月份加载中或失败 | 隐藏其他范围旧任务，展示范围不匹配提示 |
| 分页截断页面展示 | 提示数据不完整，同时保留已拉取任务 |

所有命令通过scripts/iterm-run.sh在iTerm执行，输出经tee落盘。

## Issues

四项问题已修复，未发现阻塞问题。分页50页安全上限保留，触顶时不自动扩大请求量；不进行真实TAPD写入。

配置提交改为保存成功后更新共享状态，失败不抛到页面事件，统一通过saveError反馈。分页触顶与真实接口失败分别通过warnings和errors报告。

## Not Tested

- 未连接真实TAPD、未读取.env.local内容。
- 未重新打包或执行桌面端端到端测试；页面交互使用jsdom与模拟Tauri命令。
- 未运行Rust测试：本次Rust源码与桌面配置未修改。
- 原分析发现的masked_hint/maskedHint问题不在本轮四项修复范围内。

## Artifacts

- 方案：artifacts/plan/20261012_2226_reliability-fixes.md。
- 命令证据：/tmp/team-sight-reliability-checks.log（__EXIT=0）。
- 数据加载：src/composables/useSchedule.ts、src/services/tapd/client.ts、src/services/tapd/types.ts。
- 配置提交：src/composables/useSettings.ts。
- 页面：src/pages/BoardPage.vue、src/pages/SettingsPage.vue。
- 回归测试：useSchedule.spec.ts、useSettings.spec.ts、client.spec.ts、BoardPage.spec.ts、SettingsPage.spec.ts。
