# TeamSight MCP 配置、项目范围与工时规则

> 适用版本：MCP 0.3.4／配置 schema v6，保留 0.3.3 评论快照的历史验收边界。2026-11-17 按源码及已保存的评论、默认设置、双包与本机更新证据复核；此次知识提升仅做静态对照，未重新构建、部署或执行业务测试。旧分析按快照读取。

## 设置入口与局部保存

设置页保留七类：TAPD 连接（connection）、项目（projects）、成员（members）、分组（groups）、工时（hours）、节假日与调休（calendar）、完成状态（completed）。TAPD 连接依次集中账号连接、查询工作项类型、允许的写入操作与字段；不提供团队名称、默认查询项目、写入项目名单、请假配置或旧配置导入表单。

指定设置类型时只显示对应表单；overview 为分类选择页。旧目标 write／general／leave／import 已拒绝，旧导入接口已移除。资源随服务版本注册：当前为 `ui://teamsight/settings-0.3.4.html` 与 `ui://teamsight/analysis-0.3.4.html`，已在 0.3.4 本机更新中核对资源与安装包哈希；此前评论快照验收使用 0.3.3 资源，升级后的旧卡片需要重新打开。

writeAccess 保存只提交改变的子字段，服务端合并并校验配置修订，避免回传旧项目名单或覆盖未修改配置。已有自定义字段保留。凭据继续通过 Apps 填写并保存至系统凭据库，不在对话或工具结果中回显。

## 首次安装默认值与已有配置

- 0.3.4 首次创建数据库时，`createDefaultSettings()` 默认查询 `task`、`bug`；允许 `create`、`update`、`comment`；允许 `name`、`description`、`owner`、`effort`、`begin`、`due`、`story_id`、`status` 八个标准字段，并启用中国节假日与调休。日历年度缓存初始为空，继续由分析按既有流程获取。
- 已有对象配置继续按原规范化逻辑读取：查询／操作／字段的空数组、缺失 writeAccess、关闭或缺失日历配置均不回填为首次安装默认值；自定义字段保留。缺失查询类型仍沿用原有任务／缺陷回退，不能把“缺失”和用户明确保存的空数组混为一谈。
- 设置页初始化复用核心默认值，收到正式快照后覆盖；旧快照缺失 writeAccess 时仍补空权限列表。用户取消、保存、重启及重开卡片后不自动恢复全选；保存凭据、同步项目也不覆盖这些选择。
- 此变更沿用数据库 v4／配置 v6，不迁移或重置已有配置。默认授权仍受凭据、启用且可访问项目及各操作的业务校验约束。

依据：[默认配置与规范化](../packages/core/src/settings.ts)、[配置回归](../packages/core/test/settings.test.mjs)、[存储回归](../apps/server/test/storage.test.mjs)、[设置页回归](../apps/mcp-ui/src/FormalSettings.spec.ts)、[0.3.4 实施与更新报告](../artifacts/report/20261117_teamsight034-default-settings_测试报告.md)。该报告记录当次 169 项回归通过；此处不表示重新运行业务测试。

## 成员身份与分组范围

- 不将 /users/info 的内部 id 当作成员工号。当前自动识别以响应的 nick/name 值与项目目录 UserWorkspace.user 完整账号精确匹配，不按显示姓名猜测当前用户。
- 身份解析从目录账号提取工号；无工号时以 `user:完整账号` 作为本地 staffId。成员查询若命中多个身份，返回候选，由 selectedAccount 消歧；目录不完整时保留 partial，不宣称解析完整。
- members 是身份目录，groups 才定义分组成员。同步当前用户或解析成员只保存身份，不自动加入默认团队。新安装默认分组为空；多组可重叠，defaultGroupId 指定唯一默认组。
- 成员范围依次使用显式 memberIds、显式 groupIds、self、默认组；分组成员去重。默认组为空时返回 TEAM_SCOPE_REQUIRED，不能退回整个身份目录扩大范围。
- 解析后的成员按成员 order 排序，缺省时回退身份目录位置；统计器保留传入顺序，Apps 与导出使用分析的成员顺序。旧桌面“只按 members 数组顺序、无排序字段”的约定已不适用。

源码：[身份解析与同步](../apps/server/src/scenarios.ts)、[成员范围](../packages/core/src/memberScope.ts)、[默认配置](../packages/core/src/settings.ts)。历史接口验证见 [2026-11-03 报告](../artifacts/report/20261103_teamsight-mcp-capability-completion_测试报告.md)；本次未重新请求真实 TAPD。

## 默认查询与写入项目范围

- 默认查询与写入项目范围统一取 projects 中 enabled 为 true 且 available 不为 false 的项目。
- 配置 schema v6 删除旧 tapd.workspaceIds 和 tapd.writeAccess.workspaceIds，不接受这些字段的设置保存；显式迁移保留有效字段及原 revision。
- 显式读取允许本地目录中已停用但仍可访问的项目；写入不允许停用或不可访问项目，仍受 TAPD 实际权限限制。
- 项目同步默认启用新增项目，随之进入默认查询和可写入项目范围；再次同步保留既有启停、别名、颜色和排序。
- 项目范围开放不等于操作或字段开放：始终检查持久配置的允许操作、字段，同步不会修改这些选择。评论引入时的 0.3.3 新安装默认无写入操作；当前 0.3.4 源码首次初始化允许 create/update/comment，但已有配置的空列表或缺失权限不回填为新默认值。
- 基础创建／修改、批量操作与通用操作入口复用 business.write 校验。元数据读取后、发出 POST 前再次检查修订，配置变化会阻止该次写入。

## 评论独立权限与身份

- 需求、任务、缺陷的评论读取使用可访问的项目目录；显式读取允许已停用但仍可访问的项目。发表评论／回复要求该项目启用且可访问，同时 `tapd.writeAccess.operations` 包含 `comment`。
- 连接设置提供“发表评论”选项；comment 与 create/update 独立，不依赖 `writeAccess.fields`，字段列表为空也可以在授权后发表评论。旧配置不会因更新或同步自动获得 comment 权限；本次 0.3.3 本机更新保存了原关闭状态，不能据此推断其他安装的当前权限。
- 当前令牌必须能解析成目标项目唯一完整账号；服务端不采用调用方指定的作者，也不按显示姓名猜测。目录不完整或身份歧义阻止发布。
- 发布前校验工作项存在、回复和根评论归属；异步校验后、POST 前重新检查配置修订及连接指纹与权限。仅使用现有 Bearer，不增加附件上传权限。
- 评论操作由 `business.addComment` 处理，常用工具和通用目录复用同一校验。工作项创建／修改继续走 `business.write`，不能将其字段授权条件套用到评论。

参数、文本转义、附件只读及回复关系见[评论接口](tapd-api-workitem-queries.md)。依据：[业务源码](../apps/server/src/business.ts)、[连接设置](../apps/mcp-ui/src/FormalSettings.vue)、[配置规范化](../packages/core/src/settings.ts)、[评论实现报告](../artifacts/report/20261117_评论MCP支持_测试报告.md)。

## 当前工时规则与历史快照

工时和风险统一使用 `rulesVersion:teamsight-mcp-hours-v3`。已移除 calculateHours 的 legacy／mcp policy 分支、旧请假算法及 hours.exemptions 配置；新 daily hours 不输出 leaveHours。工时目标和容量由每日规定工时、工作日历、实际花费与预计占用决定，普通排期及紧急模拟复用该容量。

缺预估按 0 处理并保留缺失标记，当天不足仍纳入风险，取数失败继续表示未知，不能当成零工时。历史分析的内容、规则版本和文件哈希保持原样，支持读取和基于快照导出；历史内容可能仍包含已退役字段，不会被自动重算覆盖。非当前规则的分析不能用于新容量、模拟或写入，返回 `ANALYSIS_RULES_OUTDATED` 并提示重新生成分析。

## 依据与验收边界

- [0.3.0 实施测试报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)：110 项回归、固定输入对照、迁移核对、隔离浏览器设置局部保存及真实宿主只读连接。
- 源码入口：[配置模型](../packages/core/src/settings.ts)、[设置模型](../apps/mcp-ui/src/settings-model.ts)、[写入校验](../apps/server/src/business.ts)、[MCP 工时规则](../packages/core/src/statistics.ts)、[历史规则保护](../apps/server/src/scenarios.ts)。
- 数据目录、正式存储与显式迁移见[运行知识](teamsight-server-runtime-notes.md)。以上历史报告只证明对应版本及范围，本次未重新运行业务测试。
