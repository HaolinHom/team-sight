# TAPD 认证、错误语义与访问能力

> 验证时间：2026-10-10｜验证方式：真实接口调用（只读）
> Base URL：`https://api.tapd.cn`｜官方文档：`https://open.tapd.cn/document/api-doc/`
> 2026-11-06 按 MCP 0.3.0 客户端复核接入路径；API 状态码及 CORS 仍为上述历史样本，本轮未重新请求。

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
| `GET /workspaces/projects` | 当时令牌返回 403：`user <id> doesn't have permission workspaces::projects`；当前客户端不以它枚举项目，不推断其他账号权限 |
| `GET /workspaces/get_workspace_info?workspace_id=` | 可用：返回**单个对象** `data.Workspace`（含 `name` / `pretty_name` / `category` / `status` / `description`），不是数组 |

- 历史响应出现 `category=project` 与 `organization`；当前客户端不按 category 筛除项目，实际范围由配置启用状态及访问能力决定，见[配置知识](teamsight-mcp-config-scope.md)。
- 项目内成员可通过 `GET /workspaces/users?workspace_id=<id>` 获取（查询限制见 `tapd-api-workitem-queries.md` 的成员目录小节）。

## 跨域与浏览器直连

- `GET` 响应带 `Access-Control-Allow-Origin: *`，看似支持跨域。
- 但 `OPTIONS` 预检（`Access-Control-Request-Headers: authorization`）返回 **404**；浏览器携带 `Authorization` 头必然触发预检，因此浏览器端无法直连 TAPD。
- 不将令牌放入 URL 查询参数绕过预检。当前 MCP Apps 通过宿主桥调用服务，由 Node 服务端携带 Bearer 请求 TAPD；不再使用已退役的 Rust 代理。
- 实现依据：[TAPD 客户端](../packages/tapd/src/client.ts)、[Apps 桥接调用](../apps/mcp-ui/src/Analysis.vue)。服务端不会受浏览器 CORS 预检约束。
