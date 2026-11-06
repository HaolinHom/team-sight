# TeamSight MCP 能力补齐测试报告

> 2026-11-07 目录整理标注：历史证据：保留接口差异、身份、排期和回执恢复的原始验收；配置 v5、DB v3、P0 兼容、旧规则及旧包地址已被 0.3.0 替代。正文脚本仅为原轮次证据，不作为当前写入或部署入口。

## Summary

实施依据：[M1–M7方案](../plan/20261103_teamsight-mcp-capability-completion.md)。本轮实现版本0.2.0，涵盖配置与身份／分组、场景上下文、MCP工时与容量、普通排期、紧急模拟、批量创建／补排期、双层Apps及运行包。使用当前工作树构建和测试，未提交、部署或重启用户现有MCP服务，未改写Codex连接配置。

本轮执行macOS arm64、Node22.23.2、Node-API10。历史环境22.23.4不是本轮命令实际版本。MCP与旧App分别构建；自动化、协议、浏览器、真实TAPD与平台实机结果分别记录。

M1–M6代码及以下自动／受控验证完成。M7运行包已交付，Windows实机及Codex原生卡片仍待验收，不能写为全平台交付验收通过。

## Results

| 范围 | 结果 | 证据及通过标准 |
| --- | --- | --- |
| MCP构建 | 通过 | core、TAPD、server及自包含Apps类型检查／生产构建通过；见[mcp-build.log](evidence/20261103-mcp/mcp-build.log) |
| MCP包级测试 | 54项通过 | core14、TAPD10、server30；见[mcp-tests-final.log](evidence/20261103-mcp/mcp-tests-final.log) |
| Apps组件测试 | 5项通过 | 背景点击／焦点／悬浮禁用、层交换、每日实际明细、初始日期竞态、完整显示日期请求；同一测试日志 |
| 旧App回归 | 386项、36文件通过 | [app-tests.log](evidence/20261103-mcp/app-tests.log)；根生产构建[app-build.log](evidence/20261103-mcp/app-build.log)通过 |
| 原生依赖 | 通过 | 真实系统凭据库哨兵往返、SQLite3.53.4、PNG渲染；[standalone doctor](evidence/20261103-mcp/mcp-standalone-doctor.log) |
| 真实MCP协议＋隔离TAPD | 通过 | 45个工具、缺配置、令牌保存后初始化、v5空默认组、排期、模拟零POST；[standalone验收](evidence/20261103-mcp/standalone/mcp-acceptance.json) |
| TAPD只读新契约 | 通过 | 当前用户接口可读；原验证需求历史4条、任务历史2条；附件接口成功且样本0条；[live-read-contracts.json](evidence/20261103-mcp/live-read-contracts.json) |
| TAPD真实批次写入 | 通过 | 一条0h测试任务，创建、重复请求零追加POST、原任务补排期及读回、完成、隔离存储关闭／重开恢复；共2次真实POST；[live-batch-write.json](evidence/20261103-mcp/live-batch-write.json) |
| 浏览器SDK宿主 | 通过指定范围 | 真实AppBridge通信、配置修改保存修订3并重开保持、任务／工时模式及详情；浏览器伪造数据，不代表Codex原生验收 |
| macOS独立运行包 | 通过 | 从含空格目录 /tmp/TeamSight MCP Standalone 20261103 运行doctor及verify-mcp，无源码node_modules依赖 |
| Windows运行包 | 结构通过，实机待验 | 生产依赖和Apps齐全、原生PE格式、全部SHA-256、源码哈希及无符号链接；未在Windows运行 |
| 压缩包 | 通过 | 两个平台ZIP完整性检查；[releases.json](evidence/20261103-mcp/releases.json)记录大小和SHA-256 |

合计：本轮MCP59项测试与旧App386项测试通过，445项；不是445项新增测试。

### 主要业务覆盖

- 身份／范围：完整目录账号匹配当前用户，拒绝内部ID冒充工号；首次项目启用、偏好保留、写授权不扩大；新成员不自动入组、多组去重、空默认组及v4范围持久迁移且不增加修订。
- 上下文：长ID与新旧TAPD链接、两种测试识别、最早完整测试排期、需求正文图片、附件与历史。官方需求／任务历史均使用WorkitemChange，每页100；附件每页200。无权限、关联筛选异常及重复／截断保留缺口。
- 工时／容量：缺预估0、实际保留、当天不足、跨窗口累计、跨项目占用、补排期只释放预计、请假容量；旧核心默认规则保持。
- 排期：4h＋4h及2h＋6h可利用周一／周三，8h连续与尽早候选、顺倒排、日期粒度同日／跨日依赖、环、缺数据与预算耗尽。候选搜索不宣称全局最优。
- 紧急模拟：direct、reallocate、multi；旧工作可移至紧急deadline之后但需早于最早测试／已知节点；所有隔离模拟的TAPD POST计数为0。
- 批次：默认当前用户、无日期创建、普通候选创建、更新原任务、意图冲突、明确失败续办、未知写入不重发、重启恢复、方案过期、模拟ID拒绝写入。批次关联在发出POST前已持久化。
- Apps：先按完整结果筛选成员／项目／日期再分页；无排期有花费可见；模拟与图表同一结果、调整前后切换；无拖拽修改。

### 真实TAPD写入对象及边界

复用此前已标记的验证需求62119705:1162119705001212279。新任务为[TeamSight MCP M5 验证任务](https://www.tapd.cn/tapd_fe/62119705/task/detail/1162119705001212647)，标题含“验证20261103”，预估0h，不代表真实工作量。只创建该任务，补排期更新同一ID，最终status=done、日期2026-11-03。未调整其他需求／成员排期。

独立回执目录.local/teamsight-mcp-m5-live保留，凭据仅在验证进程内存中使用，结束后清除内存映射；没有复制令牌到文本或测试报告。关闭／重开的是隔离业务与SQLite对象，完整独立服务进程启动另外由运行包协议验收覆盖。

真实样本为一条0h任务，不等同于真实高负荷多人批量／部分失败／未知网络结果；这些情况使用隔离传输回归。归档复现脚本为[live-batch-verify.mjs](evidence/20261103-mcp/live-batch-verify.mjs)，从仓库根目录运行需显式 --execute-writes，并复用稳定回执。不要删除验证目录后反复重跑。

### 浏览器证据

使用kimi-webbridge、官方AppBridge和隔离本地服务。浏览器分组为“TeamSight MCP 验收”。表单提交及SVG交互由DOM／CDP事件验证；不是人工逐项鼠标、真实键盘或屏幕阅读器验收。

- [任务模式截图](evidence/20261103-mcp/tasks.png)、[任务详情](evidence/20261103-mcp/tasks-detail.png)。
- [工时模式及每日贡献](evidence/20261103-mcp/hours.png)：2026-11-02实际5h＋预计3h＝8h，贡献包括未排期任务实际2h。
- [配置页](evidence/20261103-mcp/settings.png)、[保存修订3](evidence/20261103-mcp/settings-save.png)；[保存结果](evidence/20261103-mcp/browser-settings.json)与[重开结果](evidence/20261103-mcp/browser-settings-reopened.json)一致。
- [层级及交互状态](evidence/20261103-mcp/browser-gantt.json)。

## Issues

本轮发现并修复：需求历史误用StoryChange包装；批次关联晚于远端写入的恢复窗口；倒排候选先探索远离锚点的日期；紧急需求将旧任务错误限制在紧急deadline内；项目／日期筛选后分页及工时状态不一致；模拟风险沿用基线；初始分析日期被额外默认月份请求覆盖；Apps测试中两个Vue实例导致响应式事件不共享。对应构建与回归现已通过。

Windows最终打包时npm TLS连接两次中断（ECONNRESET）。使用本轮第一次已成功下载且核验npm完整性的原生依赖包缓存完成构建；缓存逐文件SHA-256、完整文件集和版本均重新校验，版本清单记录缓存清单哈希。缓存没有代替Windows运行验证。

未发现本轮已执行范围内的未解决自动测试失败。凭据审计与git diff --check结果见最终审计日志。

## Not Tested

- Codex原生卡片：当前环境列出Codex应用，但尝试cua.getApp('com.openai.codex')被工具拒绝，原文为“Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.”；[限制记录](evidence/20261103-mcp/codex-native-blocker.json)。未绕过此限制，也未改写宿主MCP连接或重启用户服务。原生令牌填写、双卡片冲突、重启后真实卡片、选择上下文反馈及用户手工操作仍需实机验收。
- Windows x64实机：当前为macOS，未有可用Windows会话；SQLite／keyring加载、服务生命周期、CodexApps与设置重开未实测。
- TAPD有附件样本的下载链接：文档契约和隔离测试通过，真实验证需求没有附件，没有真实下载链接或二进制文件样本。
- 完整期间活动：当前任务归属范围内的需求／任务历史可获取；缺陷历史及历史负责人变更导致不在当前范围的工作项没有完整扫描，不承诺全量活动审计。
- 大团队性能压力、全局最优求解、真实TAPD跨任务事务与原子CAS；后两项本来不由当前方案保证。
- Linux、DeepSeekHarness、skills、旧Tauri退役均不在本轮范围。旧App执行前端测试／构建，未重新打包并手工验收Tauri桌面。

## Artifacts

- [使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)、[平台交接](../../docs/validation/teamsight-mcp-platforms.md)。
- macOS arm64 ZIP（历史附件未留存：`../releases/teamsight-mcp-darwin-arm64.zip`）、Windows x64 ZIP（历史附件未留存：`../releases/teamsight-mcp-win32-x64.zip`）。
- 两个包各2130个受校验文件；[包校验](evidence/20261103-mcp/package-checks.json)核对全部文件哈希、当时工作树源码哈希和原生格式。ZIP不包含Node运行时、业务凭据或用户配置。
- 构建版本清单（历史附件未留存：`../releases/teamsight-mcp-darwin-arm64/versions.json`）、Windows清单（历史附件未留存：`../releases/teamsight-mcp-win32-x64/versions.json`）。
- 日志／JSON／截图统一位于artifacts/report/evidence/20261103-mcp。
