# TAPD 工作项查询、历史与附件接口

> 验证时间：2026-10-10｜验证方式：真实接口调用（只读）＋ 官方文档字段表
> 2026-11-06 按 MCP 0.3.0 源码复核实现约定；下列接口数量、字段样例与 HTTP 观察保留原采样时间，本轮未再次请求 TAPD。

## 字段差异（易踩坑）

| 维度 | 任务 `/tasks` | 缺陷 `/bugs` |
| --- | --- | --- |
| 标题 | `name` | `title`（`name` 恒为 null） |
| 负责人 | `owner`，格式 `姓名_工号;`（带尾分号，分号分隔多人） | `current_owner`，格式 `姓名_工号`（无尾分号；`owner` 恒为 null） |
| 日期 | `begin` / `due`，`YYYY-MM-DD` 或 `null` | 同左 |
| 优先级 | 推荐 `priority_label` | 同左 |
| 工时 | `effort`（预估工时，字符串原值如 `0.5`/`4`/`1`），另有 `remain`、`effort_completed`、`progress` | 同样存在 `effort` 字段，但实测样本为 `null` |

- 负责人账号可能带 `_<9位工号>` 后缀；有工号时用工号，无工号时当前 MCP 使用 `user:完整账号`。不能要求所有账号都有工号，也不能按显示姓名合并身份，见[身份与分组](teamsight-mcp-config-scope.md)。
- 日期字段不会自动推算，缺失即 `null`。
- 原始 effort 保留字符串或缺失值，不能在映射阶段把 null 改成 0。当前 MCP 分析单位为小时，计算时缺预估按 0 处理并保留缺失标记；这不证明所有 TAPD 项目的单位相同，见[工时规则](teamsight-mcp-config-scope.md)。

## 成员目录查询

- `GET /workspaces/users?workspace_id=<id>` 返回 `user=姓名_工号`、`name=姓名`，可建立「工号 → 姓名」索引（历史实测单项目 47 人，一页 200 已覆盖该样本）；当前客户端按每页 200 继续分页，不能假定所有项目均只有一页。
- **不支持按姓名/工号过滤**：传入 `name=陈` 或 `user=800119650` 仍返回全部成员。成员搜索须在拉取目录后本地匹配；当前 MCP 在服务端完成身份解析，见[成员身份与分组范围](teamsight-mcp-config-scope.md)。

## 分页

- 对任务／缺陷列表，`limit` 默认 30、最大 200（实测返回 200 条）；`page` 从 1 开始翻页。历史及附件接口的包装与页大小见下节。
- 配套 `GET /tasks/count`、`GET /bugs/count` 支持相同过滤条件，可用于分页收敛判断。
- `fields` 参数可裁剪返回字段：TAPD 默认返回数百个 `custom_field_*`，不裁剪会显著放大响应体。

## 历史与附件接口的分页差异

> 2026-11-06 经用户授权提升，按当前 MCP 0.3.0 客户端复核。下表不能用任务／缺陷的通用每页 200 假设替代。

| 接口 | 行包装 | 当前客户端页大小 |
| --- | --- | --- |
| /story_changes | WorkitemChange | 100 |
| /task_changes | WorkitemChange | 100 |
| /attachments | Attachment | 200 |

- history 返回的 story_id/task_id 须与请求匹配；过滤异常时保留缺口，不把截断、重复或权限失败当作完整结果。客户端分页最多 50 页，预算耗尽返回 incomplete。
- /attachments/down 返回 Attachment.download_url；客户端输出 expiresAfterSeconds:300。它是链接期限契约提示，不是永久下载地址，也不证明真实链接恰好在 300 秒失效。
- 2026-11-03 只读实测读到需求历史 4 条、任务历史 2 条；附件列表调用成功但样本为 0。真实附件下载及失效时间未验证，不能据空列表宣称下载链路通过。

依据：[TAPD 客户端](../packages/tapd/src/client.ts)、[原接口测试报告](../artifacts/report/20261103_teamsight-mcp-capability-completion_测试报告.md)。本次只对照源码及已有证据，没有再次调用接口。

## 时间查询（关键约束）

- 只支持闭区间写法 `字段=<起>~<止>`，例如 `begin=2026-10-01~2026-10-31`。
- 开区间会被静默忽略：`begin=~2026-10-31` 或 `begin=2026-10-01~` 不报错，但等同于不过滤并返回全量（实测某项目全量 24272 条 vs 窗口 103 条）。
- 单个字段的区间是「字段值落在区间内」的语义，`begin` 与 `due` 同时给区间只会取交集，会漏掉跨越窗口的任务。
- 正确的窗口相交查询写法：

```text
begin = <远古下限，如 1970-01-01> ~ <窗口结束>
due   = <窗口开始> ~ <远期上限，如 2999-12-31>
```

实测窗口相交 103 条，不少于仅按 begin 的 101 条与仅按 due 的 100 条。

- **范围查询天然排除缺日期任务**：窗口相交查询与单字段范围查询（仅 `begin` 或仅 `due`）都**只返回双日期齐全的任务**。实测仅 `begin` 落在 10 月的 120 条、仅 `due` 落在 10 月的 122 条样本，全部为双日期。因此单边日期任务只能通过下面的空值过滤单独获取。

## 服务端过滤能力与限制

### 空值过滤（`字段=null` 可用）

| 查询 | 结果（项目 63253157） |
| --- | --- |
| `GET /tasks?due=null` | 200 条样本全部无 `due`（193 条双缺失 + 7 条仅开始日）；`/tasks/count` 返回 **2260** |
| `GET /tasks?begin=null` | 200 条样本全部无 `begin`；`/tasks/count` 返回 **2374** |
| `GET /tasks?due=`（空字符串） | 等同于不过滤，返回双日期任务 |

结论：需要「未排期/缺日期」任务时必须使用字面量 `null`，空字符串无效；`/count` 接口同样支持该语法。

### `owner` 不支持一次传多个负责人

- `owner=姓名_工号`（单人）有效：`due=null&owner=<单人>` 命中 9 条。
- `owner=人A,人B` 与 `owner=人A;人B` 均返回 **0 条**（既不是并集，也不报错）。
- 成员并集需逐账号读取再去重。当前工时快照直接按项目／成员／类型查询工作项，不加日期条件，不再使用上述双空日期查询倍增的旧策略；服务端共享队列并发为 3。

### 状态来源与完成判定

- 任务实测出现 `open`、`progressing`、`done`；缺陷实测出现 `in_progress`、`closed`（还有其他工作流状态）。
- `progressing`、`in_progress` 这类值无法从常见枚举推断，硬编码一定会漏；状态还支持自定义（可传中文）。
- 当前工时完成判断使用 `done`／`closed`／`resolved`／`rejected`，并叠加按项目、类型配置的 completedStates，忽略大小写；不能只沿用默认终态而忽略自定义配置。状态展示保留原值。
- 当前任务写入元数据使用 documented-task-states，需求状态取项目元数据；不能将“动态获取”误读为所有入口均已提供动态状态枚举。

## 数据量级（决定必须服务端裁剪）

- 实测项目 A：任务 24272 条、缺陷 9599 条；项目 B：任务 2904 条。
- 当前月窗口内：项目 A 任务 103 条、项目 B 任务 12 条，缺陷 0 条。
- 缺日期任务量级同样不可忽视：项目 A `due=null` 2260 条（约 12 页/200）、`begin=null` 2374 条；叠加 `status=open` 后降到 206 条。
- 查询必须在服务端收窄范围。普通排期窗口查询使用日期相交条件；工时快照按所选成员账号查询以覆盖缺日期、跨月和逾期任务，不能强制套用日期窗口而漏算。

## 详情页链接形态（Web 前端）

- 正确形态（实测 HTTP 200，未登录即可命中前端路由）：

```text
任务：https://www.tapd.cn/tapd_fe/<workspace_id>/task/detail/<task_id>
缺陷：https://www.tapd.cn/tapd_fe/<workspace_id>/bug/detail/<bug_id>
```

- 上述历史样本中的单数旧形态 `https://www.tapd.cn/<workspace_id>/<task|bug>/view/<id>` 曾跳转登录页。当前生成链接使用 tapd_fe/detail；输入另接受 `/<workspace_id>/[prong/]<stories|tasks|bugs>/view/<id>`，不能把单数旧形态与该有效的复数旧链接混为一谈。
- 列表接口不返回详情页地址字段，链接需前端拼接；`workspace_id` 必须取该工作项自身的 `workspace_id`，不能跨项目拼接。
- 实测样例：
  - `https://www.tapd.cn/tapd_fe/62120799/task/detail/1162120799001210310`
  - `https://www.tapd.cn/tapd_fe/63253157/bug/detail/1163253157001041841`
- 当前生成与输入解析分别见[排期映射](../packages/core/src/schedule.ts)与[场景链接解析](../apps/server/src/scenarios.ts)；历史样本不代表本轮真实链接验收。
