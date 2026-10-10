# TAPD 认证、错误语义与访问能力

> 验证时间：2026-10-10｜验证方式：真实接口调用（只读）
> Base URL：`https://api.tapd.cn`｜官方文档：`https://open.tapd.cn/document/api-doc/`

## 认证

- 有效形态：`Authorization: Bearer <personal_token>`。实测 `GET /quickstart/testauth` 返回 `{"status":1,"info":"success"}`。
- 无效形态：把同一令牌与 Basic 认证混用（`-u "<token>:"`）返回 `401 Unauthorized`。
- 官方文档只描述 Basic（`api_user:api_password`）与 OAuth（`Bearer access_token`）两种形态，未记载 `personal_token`；「个人令牌以 Bearer 使用」属实测结论，若后续失效应优先复核认证方式。

## 错误语义（与通用预期不同，必须按状态码分支处理）

| 场景 | HTTP | 响应 info | 处理要求 |
| --- | --- | --- | --- |
| 令牌无效/失效 | 422 | `The access token provided is invalid` | 判定为凭据问题，引导用户重新配置令牌 |
| 项目不属于当前令牌所在公司 | 403 | `Personal token company does not match workspace` | 判定为项目级失败：保留其他项目数据并明确提示，不得显示为空数据 |
| 请求缺少 workspace_id | 422 | `workspace_id is required.` | 请求构造错误 |

## 项目列表能力

| 接口 | 结论 |
| --- | --- |
| `GET /workspaces/user_participant_projects` | **可用**：返回当前令牌用户参与的全部工作区（实测 14 个），含 `id` / `name` / `category` / `status`；不传参即返回全部，`limit` / `page` 被忽略（无分页） |
| `GET /workspaces` | 不可枚举：不带 `workspace_id` 返回 422 `workspace_id is required.` |
| `GET /workspaces/projects` | 403：`user <id> doesn't have permission workspaces::projects`，不要使用 |
| `GET /workspaces/get_workspace_info?workspace_id=` | 可用：返回**单个对象** `data.Workspace`（含 `name` / `pretty_name` / `category` / `status` / `description`），不是数组 |

- `category` 取值：`project`（排期项目）与 `organization`（组织级空间，如「快尚时装」）；排期看板只应使用 `project`。
- 项目内成员可通过 `GET /workspaces/users?workspace_id=<id>` 获取（查询限制见 `tapd-api-workitem-queries.md` 的成员目录小节）。

## 跨域与浏览器直连

- `GET` 响应带 `Access-Control-Allow-Origin: *`，看似支持跨域。
- 但 `OPTIONS` 预检（`Access-Control-Request-Headers: authorization`）返回 **404**；浏览器携带 `Authorization` 头必然触发预检，因此浏览器端无法直连 TAPD。
- 把令牌放入 URL 查询参数虽可绕过预检，但被技术方案 §4.3 明令禁止，不可采用。
- 结论：真实数据请求必须经桌面端（Rust 代理）；浏览器模式只能用于界面调试。
