# TeamSight 阶段4 实施方案：稳定性、测试与打包

## Summary

- 目标：按技术方案阶段4 达到可供团队日常使用的首版质量——补齐组件测试、加固异常与边界、验证性能、审计令牌泄漏、完成 macOS 打包、补文档。
- 现状：122 个逻辑单测通过，但组件测试为零（vitest 现为 node 环境、无 test-utils/jsdom）；`bundle.active: false` 尚未真正打包；只读约束已满足（Rust 侧只有 `ureq::get`，前端仅调用只读接口）。
- 明确范围（已确认）：本轮只打包 macOS arm64，Windows 先不做（不签名，文档写明首次打开方式）；性能按「真实数据 + 合成压测」验证后再决定是否需要虚拟滚动。

## Implementation Changes

**1. 组件测试（覆盖技术方案 §10.2 七项）**

- 引入 `@vue/test-utils` + `jsdom` 作为 devDependencies，按文件用 `// @vitest-environment jsdom` 局部启用。
- 看板主流程测试（`VITE_BOARD_FIXTURE=1` 固定数据）：默认时间范围为当前自然月；取消勾选成员/状态后任务行与分组同步更新；点击任务条后底部信息条显示详情且「打开 TAPD」href 正确；筛选清空后显示空状态文案。
- 异常路径测试（桩 Tauri 运行时 + mock `fetchScheduleTasks`）：部分项目失败时保留成功数据并显示可执行提示；整体失败时显示错误而非静默。
- 渲染层测试：点击成员标题行后任务行数变化、后续成员行位置不错位；成员标题行不含任务条。

**2. 异常与边界加固**

- 修复 `useCredentials.refresh()` 未捕获异常（凭据文件损坏时会冒到 `onMounted` 形成未处理拒绝）：捕获后置为「未配置」并显示「读取凭据失败：…」。
- 错误提示按原因去重，避免同一凭据/权限问题按项目重复刷屏。
- 补边界单测：单日时间范围、跨年范围、超长标题截断、异常 `effort` 原值透传、配置/凭据损坏回退。

**3. 性能验证（先测后定）**

- fixture 增加压测档 `VITE_BOARD_FIXTURE=stress`（约 2000 条任务、8 名成员、10 个项目）。
- 单元层断言 `computeLayout` 处理 2000 条任务的耗时上限（宽松阈值）；运行层在浏览器实测首屏渲染与滚动长任务。
- 决策规则：首屏 ≤1.5s 且滚动无 >100ms 长任务 → 不引入虚拟滚动并记录数据；超出则实施按可视区渲染的最小优化。

**4. 令牌泄漏审计（自动化）**

- 新增 `scripts/check-secrets.mjs` + `pnpm verify:secrets`：扫描 `dist/`、`src-tauri/target/release/`、`README.md`、`docs/` 与传入日志目录，发现明文令牌即非零退出。
- 核对并写入文档：release 构建不读取 `.env.local`；桌面端不写前端存储。

**5. macOS 打包验证**

- `bundle.active: true`、`targets: ["app", "dmg"]`，补齐最小元信息；`pnpm tauri:build` 产出 `.app` 与 `.dmg`。
- 验证：应用可启动、release 凭据来自应用内保存的文件、产物内无令牌、`.dmg` 可挂载；记录未签名产物的首次打开方式。

**6. 文档**

- README 收敛为快速上手 + 命令表 + 指向手册；新增 `docs/用户手册.md`（运行与配置、构建与打包、故障排查、只读约束与接口清单、验收核对表）。

## Interfaces and Data Contracts

- 新增 npm 脚本 `verify:secrets`；fixture 模式取值扩展为 `1 | stress`。
- 无生产接口/数据模型变更；仅内部异常处理与提示文案调整。

## Test Plan

- 组件测试：§10.2 七项逐条落地。
- 单元测试：新增边界用例，既有 122 个用例保持通过。
- 性能：2000 条合成数据布局耗时断言 + 浏览器实测。
- 安全：`pnpm verify:secrets` 全绿；核对 release 不读 `.env.local`、桌面端无 localStorage 写入。
- 打包：`pnpm tauri:build` 成功，启动 `.app` 正常，`.dmg` 可挂载。
- 回归：`pnpm test`、`pnpm build`、`pnpm tauri:dev` 与 §12 验收清单逐项核对。

## Assumptions

- Windows 打包本轮不做，但保留跨平台可编译，文档列为后续工作。
- 不做代码签名/公证，文档写清首次打开方式。
- 性能压测用合成数据，结论仅用于判断虚拟滚动必要性。
- 本轮不引入 CI/CD。
