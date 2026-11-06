# TeamSight MCP 配置、项目范围与工时规则

> 验证与授权提升日期：2026-11-06。适用于 MCP 0.3.0／配置 schema v6，更新此前 0.2.3 的兼容约定。旧分析按快照读取；Windows 实机、Codex 原生 Apps 完整交互及真实 TAPD 写入仍未在本轮验收。

## 设置入口与局部保存

设置页保留七类：TAPD 连接（connection）、项目（projects）、成员（members）、分组（groups）、工时（hours）、节假日与调休（calendar）、完成状态（completed）。TAPD 连接依次集中账号连接、查询工作项类型、允许的写入操作与字段；不提供团队名称、默认查询项目、写入项目名单、请假配置或旧配置导入表单。

指定设置类型时只显示对应表单；overview 为分类选择页。旧目标 write／general／leave／import 已拒绝，旧导入接口已移除。资源仅注册 `ui://teamsight/settings-0.3.0.html` 与 `ui://teamsight/analysis-0.3.0.html`，旧卡片需要重新打开。

writeAccess 保存只提交改变的子字段，服务端合并并校验配置修订，避免回传旧项目名单或覆盖未修改配置。已有自定义字段保留。凭据继续通过 Apps 填写并保存至系统凭据库，不在对话或工具结果中回显。

## 成员身份与分组范围

> 2026-11-06 经用户授权从能力补齐候选提取；已按 MCP 0.3.0 源码复核。

- 不将 /users/info 的内部 id 当作成员工号。当前自动识别以响应的 nick/name 值与项目目录 UserWorkspace.user 完整账号精确匹配，不按显示姓名猜测当前用户。
- 身份解析从目录账号提取工号；无工号时以 `user:完整账号` 作为本地 staffId。成员查询若命中多个身份，返回候选，由 selectedAccount 消歧；目录不完整时保留 partial，不宣称解析完整。
- members 是身份目录，groups 才定义分组成员。同步当前用户或解析成员只保存身份，不自动加入默认团队。新安装默认分组为空；多组可重叠，defaultGroupId 指定唯一默认组。
- 成员范围依次使用显式 memberIds、显式 groupIds、self、默认组；分组成员去重。默认组为空时返回 TEAM_SCOPE_REQUIRED，不能退回整个身份目录扩大范围。

源码：[身份解析与同步](../apps/server/src/scenarios.ts)、[成员范围](../packages/core/src/memberScope.ts)、[默认配置](../packages/core/src/settings.ts)。历史接口验证见 [2026-11-03 报告](../artifacts/report/20261103_teamsight-mcp-capability-completion_测试报告.md)；本次未重新请求真实 TAPD。

## 默认查询与写入项目范围

- 默认查询与写入项目范围统一取 projects 中 enabled 为 true 且 available 不为 false 的项目。
- 配置 schema v6 删除旧 tapd.workspaceIds 和 tapd.writeAccess.workspaceIds，不接受这些字段的设置保存；显式迁移保留有效字段及原 revision。
- 显式读取允许本地目录中已停用但仍可访问的项目；写入不允许停用或不可访问项目，仍受 TAPD 实际权限限制。
- 项目同步默认启用新增项目，随之进入默认查询和可写入项目范围；再次同步保留既有启停、别名、颜色和排序。
- 项目范围开放不等于操作或字段开放：允许操作、字段仍须单独配置，新安装默认无写入操作，同步不会修改这些选择。
- 基础创建／修改、批量操作与通用操作入口复用 business.write 校验。元数据读取后、发出 POST 前再次检查修订，配置变化会阻止该次写入。

## 当前工时规则与历史快照

工时和风险统一使用 `rulesVersion:teamsight-mcp-hours-v3`。已移除 calculateHours 的 legacy／mcp policy 分支、旧请假算法及 hours.exemptions 配置；新 daily hours 不输出 leaveHours。工时目标和容量由每日规定工时、工作日历、实际花费与预计占用决定，普通排期及紧急模拟复用该容量。

缺预估按 0 处理并保留缺失标记，当天不足仍纳入风险，取数失败继续表示未知，不能当成零工时。历史分析的内容、规则版本和文件哈希保持原样，支持读取和基于快照导出；历史内容可能仍包含已退役字段，不会被自动重算覆盖。非当前规则的分析不能用于新容量、模拟或写入，返回 `ANALYSIS_RULES_OUTDATED` 并提示重新生成分析。

实施阶段用本机已安装 0.2.6 core 与本次 core，对相同 5 份历史分析输入、775 个成员日期格对照：除删除的 leaveHours 输出外，工时、容量、风险一致；没有 TAPD 请求。历史 SVG/PNG/HTML 和 Markdown/HTML/CSV/JSON 报告导出亦已验证，源快照不变。

## 依据与验收边界

- [0.3.0 实施测试报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)：110 项回归、固定输入对照、迁移核对、隔离浏览器设置局部保存及真实宿主只读连接。
- [0.2.3 历史报告](../artifacts/report/20261105_teamsight-settings-simplify_测试报告.md)保留当时的七类设置及统一项目范围验证；其中旧字段、目标映射和 legacy 算法的兼容说明已由本文更新。
- 源码入口：[配置模型](../packages/core/src/settings.ts)、[设置模型](../apps/mcp-ui/src/settings-model.ts)、[写入校验](../apps/server/src/business.ts)、[MCP 工时规则](../packages/core/src/statistics.ts)、[历史规则保护](../apps/server/src/scenarios.ts)。
- 数据目录、正式存储与显式迁移见[运行知识](teamsight-server-runtime-notes.md)。本次知识提升只核对源码及已有报告，没有重新运行业务测试。
