# 知识提升 对照检查报告

## Summary

- 测试对象：候选知识 `artifacts/knowledge/20261010_phase1-knowledge-update-candidate.md` 提升为正式 `knowledge` 后的落地结果。
- 测试方式：脚本化静态检查（YAML 解析、索引引用完整性）＋ 文档内容对照（过期结论是否清除、交叉引用是否有效）。
- 结论：提升动作完整落地，未发现问题。

## Results

| 检查项 | 方式 | 结果 |
| --- | --- | --- |
| 索引 YAML 可解析 | `yaml.safe_load` 解析 4 个索引文件 | 全部通过 |
| 索引引用完整性 | 逐个校验 `items[].path`、`indexes[].path` 是否存在 | 4 个知识文件、3 个子索引全部存在 |
| 过期结论清除 | `grep "不能通过接口自动发现"` | 无命中（该结论已更正为 `/workspaces/user_participant_projects` 可枚举） |
| 交叉引用有效 | 检查两处跨文件引用 | `tapd-api-auth-and-errors.md` ↔ `tapd-api-workitem-queries.md`、`local-toolchain-notes.md` 引用目标小节均存在 |
| 候选生命周期 | `ls artifacts/knowledge` | 候选文件已删除，目录为空（内容已全部提升） |

落地位置：

- `knowledge/tapd-api-auth-and-errors.md`：项目列表能力更正为可枚举，并新增「跨域与浏览器直连」小节。
- `knowledge/tapd-api-workitem-queries.md`：新增「成员目录查询」小节（服务端不支持按姓名/工号过滤）。
- `knowledge/local-toolchain-notes.md`：新增「应用配置目录与本地凭据」小节。
- 3 个索引文件的标题/摘要/标签同步更新。

## Issues

未发现问题。

## Not Tested

- 未在真实 Agent 会话中验证「按索引加载知识后能否命中新内容」，属后续使用时的观察项。
- 知识内容的真实性依赖阶段1 的实测记录，本次仅做落地一致性检查，未重新调用接口验证。

## Artifacts

- 原始候选（已删除）：`artifacts/knowledge/20261010_phase1-knowledge-update-candidate.md`
- 阶段1 测试报告（数据来源）：`artifacts/report/20261010_2235_tapd-team-sight-phase1_测试报告.md`
- 正式知识：`knowledge/` 下 4 个知识文件与 3 个子索引
