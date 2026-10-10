# TAPD 认证形态与错误语义

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

- `GET /workspaces` 不支持枚举项目：不传 `workspace_id` 直接返回 422。
- 结论：项目清单必须由使用方配置，不能通过接口自动发现。
- 项目内成员可通过 `GET /workspaces/users?workspace_id=<id>` 获取。
