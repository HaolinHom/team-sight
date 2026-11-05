# TeamSight MCP 配置、项目范围与工时规则

> 验证与授权提升日期：2026-11-05。适用于 MCP 0.2.3；旧 Tauri App 与旧分析快照不适用新规则。本文记录已验证实现，不代表 Windows 实机或 Codex 原生 Apps 完整交互已通过验收。

## 设置入口与局部保存

设置页保留七类：TAPD 连接（connection）、项目（projects）、成员（members）、分组（groups）、工时（hours）、节假日与调休（calendar）、完成状态（completed）。TAPD 连接依次集中账号连接、查询工作项类型、允许的写入操作与字段；不提供团队名称、默认查询项目、写入项目名单、请假配置或旧配置导入表单。

指定设置类型时只显示对应表单。旧目标 write／general 映射至 connection，leave／import 映射至 overview；旧导入接口仅保留兼容。

writeAccess 保存只提交改变的子字段，服务端合并并校验配置修订，避免回传旧项目名单或覆盖未修改配置。已有自定义字段保留。凭据继续通过 Apps 填写并保存至系统凭据库，不在对话或工具结果中回显。

## 默认查询与写入项目范围

- 默认查询与写入项目范围统一取 projects 中 enabled 为 true 且 available 不为 false 的项目。
- 旧 tapd.workspaceIds 和 writeAccess.workspaceIds 保留兼容数据，但不再作为 MCP 查询与写入的项目白名单。
- 显式读取允许本地目录中已停用但仍可访问的项目；写入不允许停用或不可访问项目，仍受 TAPD 实际权限限制。
- 项目同步默认启用新增项目，随之进入默认查询和可写入项目范围；再次同步保留既有启停、别名、颜色和排序。
- 项目范围开放不等于操作或字段开放：允许操作、字段仍须单独配置，新安装默认无写入操作，同步不会修改这些选择。
- 基础创建／修改、批量操作与通用操作入口复用 business.write 校验。元数据读取后、发出 POST 前再次检查修订，配置变化会阻止该次写入。

## MCP 请假与计算版本

MCP 使用 rulesVersion:teamsight-mcp-hours-v3。calculateHours(policy:mcp) 忽略历史 exemptions，leaveHours 输出为 0；工时目标及容量由每日规定工时、工作日历、实际花费和预计占用决定。普通排期及紧急模拟复用这份容量，不扣减请假。

历史请假记录保留但不参与新的 MCP 计算。legacy 默认计算仍按原规则扣减请假，旧分析按原快照和规则读取，不自动覆盖为新结果。

## 依据与验收边界

- [设置页精简与项目范围统一测试报告](../artifacts/report/20261105_teamsight-settings-simplify_测试报告.md)：76 项包级及 UI 测试、隔离 SDK 浏览器保存往返、macOS doctor／隔离 MCP 验证、本机升级前后配置摘要对照。
- 源码入口：[设置模型](../apps/mcp-ui/src/settings-model.ts)、[写入校验](../apps/server/src/business.ts)、[MCP 工时规则](../packages/core/src/statistics.ts)。
- 上述测试是 0.2.3 实施阶段的结果；知识提升阶段仅核对源码、记录和文档链接，没有重新运行这些测试。
- Windows 实机、Codex 原生 Apps 完整交互和真实 TAPD 写入未在本轮验收。
