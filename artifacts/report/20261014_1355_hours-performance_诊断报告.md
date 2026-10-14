# 工时统计性能诊断报告

## Summary

2026-10-14 对现有代码进行源码核对和 Node SSR 合成数据基线测量；本轮没有修改业务实现，也没有执行优化后的性能验收。

## Results

| 项目 | 结果 |
| --- | --- |
| 原生请求 | tapd_get 为同步 command，调用 ureq 阻塞式 request.call；本地 tauri-macros 2.7.1 文档确认同步命令默认阻塞主线程，异步执行可转移到运行时。 |
| 前端计算 | HoursPage.vue:38 在 computed 中调用同步 calculateHours。 |
| 请求数量 | 按项目成员类型查询工作项，随后每个未结束任务单独查询完整累计；并发设为 3，尚无缓存和停止过期队列。 |
| 计算热点 | 每成员扫描全部记录与工作项；每工作项重复构造日期／筛日历；日期循环内扫描任务并做日期数组 includes；贡献查找用 find。 |
| 渲染 | 完整成员日期表格，无虚拟化；重复日期格式化和待安排汇总。当前六成员月视图的渲染耗时未测量，不能据此判定为主要瓶颈。 |

基线条件：6 成员、任务跨度 91 天、显示当前月 31 天；各任务单负责人、80h 预估、每任务 5 条历史 1h 记录；先暖运行一次，再计时三次。单位为毫秒。

| 任务数 | 记录数 | 三次同步计算 |
| ---: | ---: | --- |
| 300 | 1500 | 28 / 27 / 26 |
| 1000 | 5000 | 83 / 83 / 81 |
| 3000 | 15000 | 256 / 257 / 256 |

## Issues

阻塞式原生请求与同步前端计算均存在；前端 Promise／async 不会自动将 CPU 计算或原生同步命令变为后台线程。应优先修复原生请求执行方式，再迁移计算和减少重复工作。

## Not Tested

- 当前真实样本的网络耗时占比、原生调用实际并发和 WebView 主线程时间线未测量。
- DOM 渲染、Worker 复制和优化收益尚未测试；上述计算时间为 Node 合成基线，不代表 macOS WebView 时间。
- 本轮未重复上一轮完整功能测试或构建，因为没有业务代码修改。

## Artifacts

- 方案：../plan/20261014_1355_hours-performance.md
- 基线脚本：/tmp/team-sight-hours-perf-baseline.mjs
- 基线日志：/tmp/team-sight-20261014_1155-hours-perf-baseline.log（__EXIT=0）
- 源码检查日志：/tmp/team-sight-20261014_1155-hours-perf-inspect.log
- 线程约束核对：/tmp/team-sight-20261014_1155-hours-perf-thread.log
- 关键文件：src-tauri/src/lib.rs、src/hours/statistics.ts、src/services/tapd/hours.ts、src/pages/HoursPage.vue
