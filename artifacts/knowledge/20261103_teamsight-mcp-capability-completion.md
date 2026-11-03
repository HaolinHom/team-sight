# TeamSight MCP v0.2 能力补齐知识候选

状态：候选，未提升正式knowledge。验证日期2026-11-03。建议提升目标：knowledge/teamsight-server-runtime-notes.md，并将接口事实补充至TAPD查询／工时知识。

## 已验证稳定事实

1. 业务配置v5与SQLite user_version3是不同版本。启动将v4旧成员迁到默认组并持久保存JSON，不增加业务修订。新安装默认组为空；新发现成员仅进入身份目录。多组可重叠，默认组仅由defaultGroupId指定一个。
2. users/info的内部id不是成员工号。当前用户使用接口账号字段与项目目录UserWorkspace.user精确匹配；姓名歧义必须返回候选。无工号完整账号可用user:账号作为本地身份，不扩大团队范围。
3. 官方story_changes和task_changes均返回WorkitemChange包装，每页最大100；attachments返回Attachment，每页最大200。不能共用所有接口每页200的假设。真实验证需求读取历史4条、任务历史2条，附件列表成功但无附件样本。附件down链接默认约300秒有效，仅文档／隔离契约覆盖，未验真实附件下载。
4. MCP使用teamsight-mcp-hours-v2，缺预估0保留原始缺失，部分日期未排期；实际仍按花费日和填报人使用。取数缺口不按0，严格排期不使用统计器超量分配兜底。核心legacy默认规则与旧分析保持。
5. 补排期释放原任务预计，不释放实际；跨启用项目容量共算。排期候选、依赖与每日分配只在当前输入／TAPD重建，模拟缓存30分钟、最多50条，重启失效，没有新建计划／依赖表。
6. 搜索是有预算的确定性枚举和回溯，最多50,000状态；找到候选表示可行，不表示全局最优。预算耗尽或候选枚举未覆盖不能断言无人能承接。紧急单人／重排／多人三个模式均禁止写入；研发移动边界为同需求最早完整测试排期。
7. 批次标识／条目标识必须在POST前随原操作回执持久化。成功项复用、明确失败可续办、unknown先核对且不重发。部分成功不做远端自动删除／回滚；日期批次来源变更需为剩余项重新计算，保留batchKey/ref。真实0h标记任务验证创建、原任务补排期、读回完成、重复请求与隔离存储关闭重开，共2次真实POST。
8. Apps完整结果的成员／项目／日期筛选应先于分页。模式切换同时交换SVG顺序、透明度、点击、title与tabindex；仅设置opacity不足以禁用背景。图表和结构化结果应复用同一计算；模拟风险也需按模拟事实重新生成。
9. 官方AppBridge浏览器预览不是Codex原生验收。当前电脑工具明确禁止操作com.openai.codex；不要用绕行控制宣称原生通过。Windows包PE／文件校验也不是Windows凭据库、SQLite或Codex运行验收。
10. 新运行入口mcp:build/test/package；p0:package转发。包依赖外部Node22.14+且低于23，本轮真实运行22.23.2，历史基线22.23.4。新TEAMSIGHT_*环境变量优先，原P0变量、默认数据目录与凭据服务名为兼容保留，不能顺手改名导致旧配置／凭据失联。
11. Windows打包可显式从先前可信同目标包读取原生依赖缓存，校验版本、完整文件集合及SHA-256，记录缓存清单哈希。最终两个运行包与含空格独立macOS目录验收通过；Windows实机仍待验。

## 依据

- [本轮报告](../report/20261103_teamsight-mcp-capability-completion_测试报告.md)，含自动测试、协议、浏览器、只读接口、受控写入及平台边界。
- apps/server/src/scenarios.ts、scenario-tools.ts、business.ts、business-storage.ts、storage.ts。
- packages/core/src/settings.ts、memberScope.ts、statistics.ts、planner.ts。
- packages/tapd/src/client.ts、contracts.ts、operations.ts。
- apps/mcp-ui/src/Analysis.vue、GanttLayers.vue与scripts/package-mcp.mjs。

## 提升时需保留的边界

当前事实不能覆盖Windows实机、Codex原生卡片、真实附件下载、完整历史归属审计或多人压力测试。正式知识原有P0历史验证仍有效，应按版本保留，不将旧结论直接覆盖为全平台通过。只有用户明确要求提升时才更新正式knowledge和索引。
