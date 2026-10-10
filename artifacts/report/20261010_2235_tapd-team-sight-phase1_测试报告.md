# TeamSight 阶段1 测试报告

## Summary

- 测试对象：阶段1 交付物（本地凭据文件读写、项目/成员配置管理、设置页、按配置成员的过滤与多负责人拆行、PoC 验证入口改造）。
- 测试方式：前端单元测试、Rust 单元测试与手工网络测试、类型检查与生产构建、桌面端端到端验证、浏览器分支交互验证、凭据泄漏扫描。
- 结论：核心逻辑全部通过；桌面端设置读取链路与真实数据拉取链路验证可用；两处待人工确认项已列在「Not Tested」。

## Results

### 1. 前端单元测试（`pnpm test`）

- 结果：9 个测试文件、**76 个用例全部通过**（阶段0 为 45 个，本轮新增 31 个）。
- 新增覆盖：配置默认值与损坏回退、按工号去重、项目颜色分配、成员解析（多负责人命中/空交集）、多负责人多行展开、隐藏任务统计、项目枚举解析与 `category=project` 过滤、凭据与配置服务在 Tauri/浏览器两种运行时的分支、TAPD 错误码到用户提示的映射。

### 2. Rust 单元测试（`cd src-tauri && cargo test --lib`）

- 结果：**4 个用例通过，2 个网络用例默认忽略**。
- 覆盖：令牌掩码只暴露首尾、凭据文件写入/读取往返且权限为 `0600`、配置写入/读取往返与原子替换（无 `.tmp` 残留、非法 JSON 被拒绝）、损坏凭据文件报错。

### 3. Rust 真实接口手工测试（`cargo test -- --ignored`）

- 结果：**2 个用例通过**（Bearer 认证；`/workspaces/user_participant_projects` 返回项目列表 + 按项目拉取任务）。

### 4. 类型检查与生产构建（`pnpm build`）

- 结果：`vue-tsc --noEmit` 与 `vite build` 通过。产物：入口 JS 94.13 kB（gzip 36.88 kB）、设置页 10.19 kB、验证页 18.45 kB。

### 5. 桌面端端到端验证（`pnpm tauri:dev` + `VITE_POC_AUTOLOAD=live`）

- 预置配置：应用配置目录写入 `settings.json`（2 个启用项目 + 6 名成员），凭据走 `.env.local` 回退。
- Rust 诊断日志显示只对**配置中启用的 2 个项目**发起请求，证明 `settings_read` 命令读取应用配置目录成功、且未启用的项目不会被查询：

```text
[tapd_get] GET /workspaces/users     # 两个启用项目各一次
[tapd_get] GET /tasks/count
[tapd_get] GET /bugs/count
[tapd_get] GET /tasks
[tapd_get] GET /bugs
[tapd_get] GET /tasks/count
[tapd_get] GET /tasks
[tapd_get] GET /bugs/count
[tapd_get] GET /bugs
```

- 桌面窗口加载成功（WebKit 网络进程与 Vite dev server 建立连接），运行日志无 error/panic。
- 生成的应用运行产物（settings.json）位于 `~/Library/Application Support/com.haolinhom.team-sight/`，不在仓库内。

### 6. 浏览器分支验证（设置页交互）

| 操作 | 结果 |
| --- | --- |
| 设置页渲染 | 通过（导航、令牌区、项目区、成员区、调色板均正常） |
| 保存令牌 | 通过：状态变为「已配置｜来源：浏览器 localStorage（仅开发模式）｜devt…7890」 |
| 掩码 | 通过：只显示首尾各 4 位 |
| 清除令牌 | 通过：状态回到未配置 |
| 浏览器内读取项目 | 通过（预期失败路径）：提示「当前不在 Tauri 运行环境中，无法访问 TAPD 接口」 |

### 7. 凭据安全检查

- `dist/` 产物中未出现令牌明文。
- 仓库内（排除 `.env.local`、`node_modules`、`target`、`dist`）未出现令牌明文。
- 凭据文件仅由 Rust 进程读写，`credential_status` 只返回掩码；Rust 单测断言文件权限为 `0600`。
- 关键技术事实：TAPD 的 GET 响应带 `Access-Control-Allow-Origin: *`，但 **OPTIONS 预检返回 404**，因此浏览器无法携带 `Authorization` 头直连 TAPD；真实数据必须经桌面端 Rust 代理。

## Issues

1. **需要人工确认（不可自动化）**：开发二进制没有 bundle id，自动化工具无法绑定桌面窗口，因此「设置页点击保存/清除/测试连接、项目增删改、成员添加」这些 GUI 操作未自动执行；其后端命令与前端逻辑已分别由单测与浏览器分支验证覆盖。
2. **已知取舍**：凭据当前为本地明文文件（0600）。技术方案 §4.3 要求系统凭据存储，本轮按确认顺延；切换时只需替换 Rust 侧读写实现与 `source` 取值。
3. **知识库待更正**：`knowledge/tapd-api-auth-and-errors.md` 中「项目清单必须由使用方配置，不能通过接口自动发现」已被本轮实测推翻（`/workspaces/user_participant_projects` 可枚举 14 个项目），已生成知识候选待确认。

## Not Tested

- 桌面端 GUI 点击路径（原因见 Issues 1），风险：invoke 参数名与命令签名不匹配只能在人工点击时暴露；已通过 Rust 单测固定签名（`credential_set`/`settings_write(settingsJson)`），风险较低。
- 打包后的发布构建（`tauri build`）与发布态凭据回退行为：`.env.local` 回退被限定为 debug 构建，发布版必须先配置令牌；属阶段4 验证范围。
- 大量成员/项目下的性能（当前实测 14 个项目、单项目 47 名成员），属阶段4 范围。

## Artifacts

- 方案：`artifacts/plan/20261010_2222_tapd-team-sight-phase1.md`
- 知识候选：`artifacts/knowledge/20261010_phase1-knowledge-update-candidate.md`
- 关键代码：`src-tauri/src/lib.rs`、`src/services/settings.ts`、`src/services/credentials.ts`、`src/composables/useSettings.ts`、`src/utils/memberResolution.ts`、`src/pages/SettingsPage.vue`
- 命令日志：`/tmp/team-sight-logs/`（`test-build-p1.log`、`tauri-dev-p1.log`、`cargo-test-ignored-p1b.log`）
