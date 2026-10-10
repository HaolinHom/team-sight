# 候选知识提升 对照检查报告

## Summary

- 对象：将 `artifacts/knowledge` 中的候选知识提升为正式 `knowledge`。
- 本轮提升的候选：`20261010_tapd-null-filter-and-effort-candidate.md`（TAPD 空值过滤、owner 多值查询限制、工时字段、状态动态取值）。
  - 另外两条候选（Tauri 外部链接、TAPD 详情页 URL 形态）在前序轮次已完成提升，本轮无待处理内容。
- 方式：逐条内容对照核对、知识索引完整性检查、候选目录清理检查，并在当天重新实测语法类结论。
- 结论：候选内容全部落地，索引无失效路径，候选目录已清空；当天复核结果与知识记录一致。

## Results

### 1. 内容对照核对（候选事实 → 正式知识）

- 目标文件：`knowledge/tapd-api-workitem-queries.md`。
- 核对 22 个关键事实点（含 `due=null`、`begin=null`、计数 2260/2374、空字符串无效、范围查询只返回双日期任务、120/122 条样本、`owner` 多人返回 0 条、单人 9 条、192 次请求推算、`effort`/`remain`/`effort_completed`/`progress`、缺陷 `effort` 为 null、不臆断单位、`progressing`/`in_progress`/`resolved`、保留原始状态值）：**全部命中，无遗漏**。
- 知识文件新增/调整结构：字段差异表补充「工时」行与三条说明；时间查询小节补充「范围查询天然排除缺日期任务」；新增「服务端过滤能力与限制」小节（空值过滤 / owner 多值 / 状态动态取值）；数据量级小节补充空值查询量级。

### 2. 索引与目录完整性

- 根索引 `knowledge/index.yaml` 引用的 4 个子索引文件均存在（tapd-api / gantt-rendering / tauri-desktop / local-environment）。
- 各子索引中的 `path` 字段全部指向存在的知识文件，无失效路径。
- `knowledge/tapd-api-index.yaml` 中该条目的 summary 与 tags 已同步更新（新增 null-filter / effort / status）。
- `artifacts/knowledge` 剩余候选文件数：**0**（已提升的候选文件按规则删除）。

### 3. 当天重新实测（2026-10-11，只读）

| 复核项 | 结果 | 与知识记录一致性 |
| --- | --- | --- |
| `GET /tasks?due=null` 样本分布 | 200 条：193 无日期 + 7 仅开始日 | 一致 |
| `GET /tasks?begin=null` 样本分布 | 200 条全部无 begin | 一致 |
| `/tasks/count?due=null` | 2260 | 一致 |
| `/tasks/count?begin=null` | 2374 | 一致 |
| `/tasks/count?due=null&owner=<单人>` | 9 | 一致 |
| `/tasks/count?due=null&owner=<人A,人B>` | 0 | 一致 |
| `/tasks/count?due=null&owner=<人A;人B>` | 0 | 一致 |

## Issues

- 未发现问题。

## Not Tested

- 阶段0 记录的历史量级（如某项目全量任务 24272、缺陷 9599）未在本次逐项重新核对；这些数字属当时实测记录并标注了验证日期，不影响本轮提升内容。
- 状态取值样例（`progressing`、`in_progress` 等）由阶段3 的加载结果观察得到，本次未再单独抽样统计。

## Artifacts

- 正式知识：`knowledge/tapd-api-workitem-queries.md`
- 索引：`knowledge/index/tapd-api-index.yaml`
- 已删除的候选：`artifacts/knowledge/20261010_tapd-null-filter-and-effort-candidate.md`
