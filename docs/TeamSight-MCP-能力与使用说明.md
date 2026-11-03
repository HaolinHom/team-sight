# TeamSight MCP 能力与使用说明

版本 0.2.0，对应《TeamSight MCP 场景与能力职责梳理》的 MCP 实现。MCP 负责配置、取数、计算、任务操作与页面；需求理解、拆解方法、最终估时、报告格式和业务风险判断仍由 Agent／后续 skills 负责。

## 配置与人员范围

首次业务调用缺少令牌时返回 CONFIG_REQUIRED 与 teamsight_open_settings 入口。Agent 打开设置卡片，用户在卡片内填写 TAPD Token。保存后自动同步项目及当前用户；初始化失败时保留已保存配置并返回 bootstrap 缺口，可重新同步后继续读取。卡片提供“继续原读取请求”按钮，宿主是否继续执行由宿主处理。令牌不通过对话填写，不从配置读取工具返回。

- teamsight_get_config：读取非敏感配置和修订。
- teamsight_update_config：携带 expectedRevision 修改非敏感设置；不会修改 TAPD 写入授权。
- teamsight_sync_projects：新项目全部启用，再次同步保留别名、颜色、启停和顺序；不可访问项目保留偏好并标记 unavailable。
- teamsight_resolve_members：本地身份优先，再读取 TAPD 目录；歧义返回候选，选定唯一完整账号后保存身份。

成员身份目录与统计团队分开。成员可属于多个组，defaultGroupId 指向唯一默认组；testing 标记测试人员组。新安装默认组为空，新发现成员不会自动入组。v4 迁移时将旧成员加入默认组以保留原范围。删除成员只删除本地身份和分组关联。

个人工作查询默认 scope:self；团队查询传 scope:team。显式 memberIds 优先，其次 groupIds；多个组会去重，未指定团队范围时使用默认组。成员与项目顺序可在卡片调整。没有指定负责人时，普通排期及批量创建采用令牌对应的已验证当前用户；目录账号不可确认时要求补充信息，不按显示名任意选人。

## 读取需求与期间工作事实

teamsight_get_requirement_context 接收 reference（TAPD 链接或 workspaceId/entityType/id），返回需求正文、关联任务、负责人、状态、预估、日期、测试边界、正文图片／链接和附件元数据。includeHistory:true 可附带需求历史；includeMaterials:false 可省略材料查询。识别当前 tapd_fe 链接及既有 prong 详情链接，ID 保留字符串。

teamsight_get_work_context 接收 start/end、analysisDate 及人员／项目范围，分别返回 currentItems、actualRecords、periodEvents 和 activityCoverage。需求、任务变更使用有来源的历史接口；工作项当前状态不能冒充期间状态。当前覆盖中的任务按项目分批读取历史；未扫描全部项目的历史负责人变更，也未聚合缺陷历史。

通过 tapd_list_operations、tapd_describe_operation、tapd_call_operation 使用同一契约调用基础能力。新增目录项包括 users.current、workspace.members、story.history、task.history、attachments.list、attachments.download_link。历史每页100条，附件每页200条，分页有界并检测重复／截断。附件短期下载链接默认约300秒有效，不自动下载文件。无权限或接口异常返回缺口，不能解释为没有材料。

## 工时与容量

新分析使用 rulesVersion:teamsight-mcp-hours-v2；旧分析保持原快照和规则，旧 App 默认计算不变。

- 缺预估按0，保留 estimateMissing；非空非法值及取数失败仍为未知。
- 缺任一日期视为未排期；实际工时仍按花费日期及填报人统计。
- 剩余量为 max(预估−截至计算日累计实际,0)，不再额外增加50%余量。
- 过去按实际，当天及未来按实际＋剩余预计分配判断不足，当天参与提醒。
- 每日目标由规定工时、中国日历及小时请假共同确定。新排期可用容量为 max(目标−实际−其他任务预计占用,0)。
- 补排期／模拟移动只释放目标任务预计占用，保留已发生实际；负责人跨所有启用且可访问项目的占用共同计算。

不完整累计、分页缺口、日历缺源或身份问题不按0处理，排期返回 needs_information。已有超负荷保留展示，新排期不会用超负荷兜底。

## 普通排期

teamsight_plan_schedule 接收最终估时的 tasks、负责人候选、窗口和依赖，返回 continuity（完整连续优先）及 earliest（尽早完成）候选。它不写 TAPD。

示例参数（ID 需替换为实际值）：

~~~json
{
  "tasks":[{"ref":"frontend","title":"前端实现","hours":8,"projectId":"1","storyId":"101","memberIds":["100"]}],
  "start":"2026-11-03","end":"2026-11-13",
  "direction":"backward",
  "anchor":{"date":"2026-11-16","allowSameDay":false},
  "milestones":[{"ref":"integration","date":"2026-11-16"}],
  "dependencies":[{"before":"frontend","after":"integration","delivery":"可联调页面","source":"user"}]
}
~~~

依赖默认要求前置任务在节点前的工作日完成；显式 allowSameDay:true 允许日期粒度的同日交接。任务可跨间隔工作日安排，同需求跨度是偏好；4h＋4h 或2h＋6h 都允许利用周一／周三容量。默认搜索未来90个自然日，倒排默认锚点前90日且不早于分析日，最多366日。

为已有任务补排期时提供 originalTaskKey（projectId:task:id），刷新 TAPD 后按其真实剩余量计算，不重新估计或创建任务。

候选搜索采用确定性区间填充与回溯，最多50,000状态，每种优先策略最多收集200个候选。候选是已验证可行的方案，不承诺全局最优。结果为 feasible、infeasible、search_incomplete 或 needs_information；仅可证明的容量不足／依赖环等返回 infeasible，预算耗尽不能解释为无人能接。

## 紧急需求

teamsight_simulate_urgent 的 mode 为 direct、reallocate 或 multi；必须提供 deadline。所有模式只读，calculationId 不能交给写入工具执行。

- direct：逐候选成员判断直接承接。
- reallocate：仅移动未来剩余工作，保留原负责人、测试任务及固定节点。研发任务以同需求最早完整测试排期为边界；无测试排期时仍受需求截止日、窗口与输入依赖约束。缺关联或边界取数不完整的任务保持锁定。
- multi：Agent 提供可独立的工作单元、依赖与候选人员，服务计算分配；默认允许移动其他研发任务，可用 allowReallocation:false 禁止。

测试按任务名称含“测试”，或负责人属于 testing 分组／testerMemberIds 识别。结果中的 affectedTaskKeys 表示参与重排计算的任务集合，具体变动以选定候选及调整前后对比为准。业务上是否可拆分及如何估时仍由 Agent 决定。

## 创建、补排期和批次恢复

teamsight_write_tasks 接收稳定 batchKey 和逐项 ref/workspaceId/fields：

1. 仅拆解估时：创建关联 story_id 的任务，begin/due 留空。
2. 同时排期：提供普通 calculationId 与 candidateId，按候选补充日期及负责人。
3. 后续补排期：传已有 id 和最新 expectedDigest，更新原任务。

写入必须先在设置卡片显式启用项目、操作和字段授权。自动同步不会扩大授权。最终估时与候选必须一致；写入前刷新容量来源，STALE_PLAN 返回最新分析及重算结果。每项写入仍进行字段元数据校验、修改冲突检查及读回核对。

teamsight_get_task_batch 返回逐项回执、实际字段及 TAPD 链接。成功项复用；明确失败项可用 retryFailed:true 续办；unknown 项先只读核对，禁止换键重发。已知远端 ID 可以自动核对；未知创建 ID 需先搜索标记任务，再用 tapd_verify_operation 提供 candidateId。批次关联在远端请求前持久化，服务重启不会丢失未知项。

带日期批次部分成功后，已成功写入会改变来源快照。为剩余项重新计算候选，再沿用 batchKey/ref 续办；不要自动删除成功项或尝试远端事务回滚。TAPD 不提供跨任务事务和原子 CAS，仍可能发生并发变化，回执必须逐项检查。

## Apps、缓存与交付

teamsight_open_analysis 接收 analysisId 或 calculationId。默认任务优先；工时优先交换前后层级。背景半透明且无点击、悬浮及键盘焦点；前景可点击、悬浮查看详情。成员／项目／日期筛选在完整结果上执行后分页；未排期任务在明细保留，实际仍显示在工时层。图表选择和筛选通过 updateModelContext 反馈宿主。模拟可以切换候选及查看调整前，无拖拽写入。

模拟结果仅在当前进程缓存30分钟、最多50条，重启／过期需重新读取并计算；不保存协作关系或排期计划表。配置v5和批次回执沿用 SQLite v3 JSON；旧分析、资源与工具保留。固定报告和静态导出保留，不能等同于 skills 周报／月报。

使用 pnpm mcp:build、pnpm mcp:test、pnpm mcp:package darwin-arm64 或 win32-x64。运行依赖外部 Node.js 22.14+（低于23），本轮macOS验证版本22.23.2。独立运行与 Codex 操作步骤见[平台验收说明](validation/teamsight-mcp-platforms.md)。Windows实机、Codex原生卡片与真实批量写入的验收状态见本轮测试报告；浏览器预览与自动测试不能替代这些结果。
