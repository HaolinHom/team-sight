# TeamSight MCP 平台与 Codex 验收

当前发行目标：macOS arm64、Windows x64，外部 Node.js 22.14+ 且低于23，本轮macOS验证22.23.2（历史运行基线22.23.4）。Linux及其他架构未验收。配置v5，SQLite user_version仍为3。

## 构建及独立运行

源码执行 pnpm mcp:build、pnpm mcp:test。pnpm mcp:package darwin-arm64 或 pnpm mcp:package win32-x64 生成无符号链接的生产依赖包。仅提供 mcp:package，旧阶段命令已移除。版本清单包含 apps 与 packages 的工作树源码哈希；Windows 包的结构检查不能代替实机运行。网络不可用时，可将 TEAMSIGHT_MCP_NATIVE_CACHE 指向此前已验证的同目标运行包；打包器核对依赖版本、完整文件集与 SHA-256，版本清单记录缓存来源清单哈希。

在独立且含空格的目录解压对应平台包，配置 Node22 PATH。先运行 node dist/cli.js doctor，再运行 node verify-mcp.mjs --evidence-dir ./evidence。doctor会在隔离目录创建/清理系统测试凭据，输出中不含明文。verify-mcp验证真实MCP传输和模拟TAPD接口，不触及业务TAPD。

运行 node dist/cli.js serve --data-dir ./data --port 43127，使用 node dist/cli.js status/stop --data-dir ./data 查看/停止实例。仍支持原 TEAMSIGHT_P0_DATA_DIR，优先使用 TEAMSIGHT_DATA_DIR。原配置/凭据/回执不被新目录自动覆盖。

## Codex 接入

通过宿主 MCP URL 配置入口连接 http://127.0.0.1:43127/mcp，访问令牌使用数据目录 access-token 对应的本机环境变量；不要将它或 TAPD 令牌贴入对话。不是将 ZIP 改名为 Bundle 安装。配置前保留宿主既有其他连接。

分别实测：

1. 工具发现、teamsight_status，多对话同一进程。
2. 未配置TAPD的业务请求引导 teamsight_open_settings(target:connection,continueRead:true)；在真实卡片填写令牌，保存后项目全部启用、当前用户准确。重新同步保留别名、颜色和排序。
3. 定向项目／成员等配置只展示目标表单，普通设置展示分类入口；保存、重开、两卡片修订冲突、失败后草稿、服务重启与凭据读取。新成员只保存身份，多分组且仅一个默认组。
4. 原生分析卡片任务优先/工时优先切换，背景无点击、悬浮和焦点，前景详情；卡片没有成员/项目/日期筛选入口，操作区只保留模式切换，范围通过对话指定。无排期有花费仍可查看。
5. 通过对话查看普通候选、倒排和紧急模拟前后结果，卡片不提供候选／基线切换控件。模拟使用进程内缓存30分钟，重启/过期后重新计算；模拟无写入。
6. 在专用验证项目检查普通批量创建、补排期、重复请求和读回。未知操作先查回执和核对，不换键重发。
7. 记录操作系统/架构/Node/Codex版本、包清单、日志、截图和结果。Windows需在真实Windows上完成同样步骤；macOS结果不代替Windows。

## 已知能力边界

需求正文、正文图片/链接、附件元数据、需求及任务历史均通过登记接口读取。附件下载链接按需获取（默认约300秒有效），服务不自动下载文件。接口无权限、分页不完整或关联筛选异常时明确返回缺口。缺陷历史尚未接入期间活动聚合，不能把当前状态等同于期间完整状态变化。报告模板与风险方法留skills。既有分析和技术导出保留，不等同于业务周报。
