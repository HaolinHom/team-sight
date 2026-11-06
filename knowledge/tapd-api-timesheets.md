# TAPD 工时查询与每日统计

> 适用实现：MCP 0.3.0，2026-11-06 源码复核。接口事实来自 2026-10-14 真实只读样本；本轮未重新请求 TAPD。

## 接口与身份

- GET /timesheets 返回 Timesheet 包装对象，GET /timesheets/count 返回 data.count。当前读取 id、workspace_id、entity_type、entity_id、owner、spentdate、timespent、is_delete。
- spentdate 使用 YYYY-MM-DD~YYYY-MM-DD 闭区间。每日实际独立按花费日期查询，截止日为展示结束日与计算日的较早值；整个展示区间在未来时不读取每日实际。
- 工时 owner 不一定含工号后缀。当前 MCP 启用完整账号身份，无工号时使用 `user:完整账号`；目录解析和歧义边界见[配置知识](teamsight-mcp-config-scope.md)。
- 工作项按项目、成员账号与类型分别查询，任务用 owner、缺陷用 current_owner，不用多个负责人拼接一次求并集。当前工时快照查询不加排期日期限制，以保留缺日期、跨月和逾期任务。
- 未结束工作项的累计花费按 entity_type、entity_id 和 1970-01-01~计算日独立读取，不按当前负责人过滤。历史实际归填报人，累计花费用于扣减任务总剩余量。
- 样本花费可按小时解析，当前 MCP 计算及输出契约为小时；API 字段本身不证明所有 TAPD 项目采用相同单位，接入时仍需确认项目约定。

## 分页、去重与不完整性

- 列表默认每页 200，最多 50 页。首个满页尝试 count；已知 count 时短页仍不足总数会标记不完整，count 不可用则继续到短页。重复／缺失记录 ID、异常包装和预算耗尽均不能当完整数据。
- 工时按项目 ID＋记录 ID 去重，删除标记为 1 的记录不计，仅统计 task／bug。每日与累计查询的重叠记录仍按同一键去重。
- 累计查询校验返回记录关联的工作项，防止远端忽略筛选时误扣；日期、工时或身份无法解析时保留 issues。
- 实际按花费日期及填报人汇总；预计分配考虑全部负责人份额。先计算完整有效任务区间及竞争同日容量的任务，再裁剪展示范围。
- 累计或身份不完整时不能给出确定的预计不足结论；逾期工作项累计读取失败时，待安排剩余量保持未知。新计算规则统一为 `teamsight-mcp-hours-v3`，详见[配置与工时规则](teamsight-mcp-config-scope.md)。

## 当前源码与历史证据

- [TAPD 分页客户端](../packages/tapd/src/client.ts)、[工时快照](../packages/tapd/src/hours.ts)、[统计器](../packages/core/src/statistics.ts)。
- [初次真实样本报告](../artifacts/report/20261014_1155_daily-hours_测试报告.md)仅证明当时有限项目与日期，不将旧桌面脚本、测试路径或临时日志作为当前入口。
- [0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)记录当前规则对照与回归边界；不据旧样本推断所有自定义状态、账号格式或项目单位一致。
