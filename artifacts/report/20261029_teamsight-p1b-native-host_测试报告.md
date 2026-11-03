# TeamSight P1b 原生卡片连接诊断测试报告

## Summary

2026-10-29，用户要求在当前 Codex 会话调用 `teamsight_status`，并通过 `teamsight_open_analysis` 展示分析 `ec2f9653-5e90-4cf1-9e8a-f95c89886fe4`。首次检查连接配置、宿主 MCP 初始化及服务端协议调用；用户重连后，当前会话已加载 TeamSight 工具，状态及打开指定分析的原生工具调用成功。用户进一步确认“可以看到，我已经将卡片放到侧边进行展示了”，原生卡片显示通过；交互、宿主文件呈现及设置保存往返仍待人工确认。未修改产品代码或 Codex 配置，未发送 TAPD 写入。

## Results

### 首次连接诊断

| 检查 | 结果 |
| --- | --- |
| 当前会话工具目录 | 未加载 TeamSight 工具 |
| 指定服务名 `teamsight_p1b` | 宿主返回 `unknown MCP server 'teamsight_p1b'` |
| 实际配置 | 连接名为 `teamsight_p0_probe`，URL 已为 `http://127.0.0.1:43129/mcp`，身份与 P1b 访问令牌匹配；令牌值未输出 |
| 实际连接名的宿主 MCP 初始化 | FAIL，`HTTP 502`，错误发生在 initialize 阶段，尚未调用原生会话中的业务工具 |
| 服务健康读取 | PASS，`phase=P1b`、`version=0.1.0-p1b` |
| 独立 SDK 直接 MCP 调用 | PASS，`teamsight_status` 返回 P1b；`teamsight_open_analysis` 返回指定分析，8 个工作项、1 名成员、5 条风险、0 个问题 |
| 工具 UI 关联 | PASS，关联 `ui://teamsight/analysis-p1b.html` |
| 当前 Codex 原生卡片展示 | NOT RUN，宿主连接未建立，不能计为通过 |

Node 验证脚本通过 iTerm 运行，退出码为 0。直接 SDK 结果只证明服务端协议调用可用，不等同于原生卡片已展示。

### 重连后当前会话复验

用户回复“继续打开卡片”后，实际通过当前会话连接 `teamsight_p0_probe` 调用业务工具，未使用独立 SDK 替代。

| 检查 | 结果 |
| --- | --- |
| 当前会话工具目录 | PASS，已加载 `teamsight_status` 与 `teamsight_open_analysis` |
| 原生 `teamsight_status` | PASS，`phase=P1b`、`version=0.1.0-p1b`、`pid=3523`、`instanceId=e172efd0-e464-4544-976a-ce62e5344cdc` |
| 原生 `teamsight_open_analysis` | PASS，传入 `analysisId=ec2f9653-5e90-4cf1-9e8a-f95c89886fe4`，返回 `status=complete`、`snapshotId=7164ce0e-8fa2-4d3a-afda-20a4f7520554` |
| 固定分析范围与计数 | PASS，2026-10-28 至 2026-11-04，Asia/Shanghai，8 个工作项、1 名成员、5 条风险、0 个问题；沿用原快照，没有重新取数 |
| 原生卡片实际显示 | PASS，用户确认卡片可见，并已放到侧边展示；依据为用户反馈，Agent 未自动操作原生界面 |
| 原生卡片交互与宿主文件呈现 | PENDING，尚无成员/范围筛选、明细/风险依据展开、导出与文件预览的人工操作结果 |
| P1b 设置新增表单保存往返 | PENDING，尚无保存、重开核对及恢复测试配置的人工操作结果 |

## Issues

首次宿主连接初始化返回 502，而同机直接访问及 SDK MCP 调用成功。用户重连后，当前会话原生业务工具调用已成功，连接问题未再出现；此前 502 的根因仍未确定。

连接名仍为 `teamsight_p0_probe`；名称与服务实际 phase 分开判断，不能因旧名称认定服务仍是 P0。

## Not Tested

已成功调用当前 Codex 原生工具打开指定分析，用户已确认侧边卡片实际显示。成员/范围筛选、明细与风险依据展开、导出与宿主文件预览、P1b 设置新增表单保存往返仍待人工验收；可见卡片不能代替这些操作结果。此前原生界面自动操作被工具安全策略禁止，本轮未尝试绕过限制。

P1b 尚未据此判定为阶段验收通过，未进入 P1c。

## Artifacts

- [协议诊断结果](./20261029_teamsight-p1b-native-host_evidence/protocol-diagnostic.json)
- [iTerm 验证日志](./20261029_teamsight-p1b-native-host_evidence/protocol-diagnostic.log)
- [P1b 主测试报告](./20261028_teamsight-p1b_测试报告.md)
