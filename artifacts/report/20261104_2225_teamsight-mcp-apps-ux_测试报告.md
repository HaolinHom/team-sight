# TeamSight MCP Apps 体验优化测试报告

## Summary

实现已确认的 MCP Apps 优化方案：定向配置、局部保存、最小甘特图、橙色主题。server/UI 版本为 0.2.1，保留现有 45 个工具与旧资源地址。未改工时内核、排期算法、TAPD 写入语义及旧 Tauri 页面。

本轮在 macOS arm64、Node 22.23.2 下执行构建、组件与服务测试、隔离浏览器 SDK 验证、运行包校验和本机服务升级。浏览器页面通过真实 MCP SDK 桥连接隔离数据和内存凭据，不连接业务 TAPD；业务服务仅做状态、非敏感配置和资源读取。

## Results

| 验收内容 | 结果与证据 |
| --- | --- |
| 构建 | pnpm mcp:build 通过；最终 UI 单独构建通过，含 vue-tsc。Vite 提示上游 Zod PURE 注释位置，不影响输出。 |
| 核心及适配器 | core 14 项、tapd 10 项通过；代码未改动这两个包。 |
| 服务 | 31 项通过。新增定向打开、初始模式、视图范围校验、无参数默认分析、旧资源兼容、嵌套局部合并与修订冲突验证。 |
| UI | 12 项通过：定向表单、局部提交、草稿保护、部分初始化不续读、分页、过期响应、异步作业、图层及未排期花费。最终保存测试直接点击按钮。 |
| 项目配置浏览器 | target:projects 只展示项目表单，没有其他分类导航。修改隔离项目别名后保存成功，重开保留；普通设置显示分类入口与状态摘要。 |
| 甘特图浏览器 | 只有两种模式操作；前景任务 Enter 打开详情，工时 Space 打开详情；切换清理原选择，背景无可点击或悬浮对象。 |
| 数值一致 | 前端成员 11-02 实际 5h、预计 3h、目标 8h；贡献含有排期任务实际 3h、未排期修复实际 2h。详情与结构化事实一致。 |
| 布局与主题 | 宽屏时间轴填充可用宽度；420px 窄屏名称和日期可读；深色模式数字增加独立底色保证对比；完成后恢复浏览器宽度和主题模拟。 |
| macOS 包 | doctor 的 SQLite、系统凭据库和 PNG 通过；verify-mcp 验证 45 工具、初始化、普通排期及紧急模拟，业务 TAPD POST 为 0。 |
| Windows 包 | 构建成功，Windows 原生依赖从旧包校验版本、文件集和 SHA-256 后复用；未在 Windows 运行。 |
| 本机安装 | 从 0.2.0 升为 0.2.1；Codex 的 teamsight_status 返回新版；配置修订前后均 14，凭据存在，本机 bearer 保持一致，9 项项目和 8 位成员保留。安装包 2130 个文件校验全部一致。 |
| 静态检查 | git diff --check 通过；单文件 Apps 资源无外部 script、modulepreload 或相对模块引用。 |

当前各套件合计 67 项自动测试通过。完整 mcp:test 首次运行因新增测试使用 2020 年日期而触发 366 日范围上限，断言期望与实际错误类型不同；将样本改为相邻越界日期后，服务 31 项复验通过。UI 最终 12 项单独复验通过，没有将首次整套命令标记为成功。

## Issues

已处理的问题：

- 浏览器沙箱未启用 allow-forms 时原生提交事件不会触发，保存改为显式按钮事件并保留表单校验。
- 宽屏时间轴原先上限造成右侧空白，改为按日期数量填充宿主宽度。
- 深色工时条浅底上的数字对比不足，增加主题背景标签。
- 令牌初始化身份未确认时，按部分完成显示并提供重试，不冒充初始化成功。

Kimi 浏览器扩展未连接；按技能要求未重试该通道，使用可用的 Codex 内置 Chrome 控制完成浏览器验证。

## Not Tested

- Codex 原生对话区／侧栏的完整保存、主题、悬浮与交互：工具连接和打开调用已成功，但没有可自动控制的展开 Apps 侧栏，未把浏览器 SDK 结果当成原生验收。
- 当前对话的工具描述缓存仍为旧契约；建议新开对话后使用“打开项目配置”等新参数路径。
- Windows 实机、屏幕阅读器完整审计、密集月份／大量成员的性能与滚动专项测试。
- 真实 TAPD 任务写入和真实令牌首次输入；本轮不需要修改业务数据。令牌续读的原生宿主行为仍需实测。
- Linux、DeepSeek Harness、skills 和 Tauri App 全量回归不在本轮范围。

## Artifacts

- 方案：[Apps 优化方案](../plan/20261103_1441_teamsight-mcp-apps-ux-redesign.md)
- 使用说明：[MCP 能力与使用说明](../../docs/TeamSight-MCP-能力与使用说明.md)
- 日志与安装记录：[证据目录](20261104_mcp-apps-ux/)
- 截图：[项目保存](20261104_mcp-apps-ux/projects.png)、[保存后重开](20261104_mcp-apps-ux/projects-reopened.png)、[分类入口](20261104_mcp-apps-ux/settings-overview.png)、[任务详情](20261104_mcp-apps-ux/tasks.png)、[窄屏工时](20261104_mcp-apps-ux/hours-narrow.png)、[深色工时](20261104_mcp-apps-ux/hours-dark.png)。均为隔离 SDK 浏览器截图。
- 新运行包：artifacts/releases/teamsight-mcp-darwin-arm64.zip 与 teamsight-mcp-win32-x64.zip；SHA256SUMS.txt 提供校验。
- 旧运行包归档：artifacts/releases/0.2.0。
- 安装位置：/Users/haolin/Library/Application Support/TeamSight MCP/versions/0.2.1。
- 升级前备份：/Users/haolin/Library/Application Support/TeamSight MCP/backup-0.2.0-20261104（数据、原启动脚本）；原 0.2.0 安装目录保留。
