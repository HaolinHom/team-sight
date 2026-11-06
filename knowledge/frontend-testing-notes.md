# MCP Apps 前端与 Vue 组件测试

> 验证时间：2026-10-11｜验证方式：本项目阶段4 实际接入（组件测试 7 项全部落地并通过）

## MCP 0.3.0 当前工程约定

> 2026-11-06 验证并经用户授权提升；下文旧 Tauri 页面和路由测试为历史记录，相关 src 文件已移除。

Vue、Vue Test Utils、jsdom、Vitest、Vite 由 `apps/mcp-ui/package.json` 自身声明并解析，根包不声明 Vue。避免将 UI 测试依赖分散到根包造成 Vue 测试运行时分裂。根 `pnpm test` 转发全量 MCP 回归；UI 单独运行 `pnpm --filter @teamsight/mcp-ui test`，构建运行 `pnpm --filter @teamsight/mcp-ui build`。

实施阶段完整 110 项测试通过，其中 UI 40 项；隔离 SDK 浏览器验证设置局部保存、任务／工时切换、虚拟排期及抽屉，组件测试覆盖 hover／focus。preview 位于 `apps/mcp-ui/test/preview-mcp.mjs`，让 Vite 从 UI 包解析。隔离浏览器验证不能替代 Codex 原生 Apps 完整交互验收。

依据：[0.3.0 测试报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)。本次提升未重跑测试。

## MCP Apps 沙箱保存与分页一致性

> 2026-11-06 经用户授权从定向界面候选提取，按 MCP 0.3.0 源码复核。

### 沙箱中的保存链路

2026-11-04 SDK 隔离 iframe 未包含 allow-forms 时，原生表单提交被阻拦，未进入保存链路。当前设置页以 `type="button"` 的 click 显式调用 save，保存前执行 form.reportValidity()，保留浏览器字段校验；不能只依赖原生 submit。页面仍有 submit.prevent 绑定，但它不是该沙箱下可靠的唯一保存入口。

桥接调用前用 JSON 序列化生成普通参数，避免直接传递 Vue 响应式对象。settingsPatch 只提交修改字段，服务端按 hours、chinaCalendar、tapd 及 writeAccess 子字段合并并校验 expectedRevision；局部对象不能覆盖整个持久化配置。现行设置范围见[配置知识](teamsight-mcp-config-scope.md)。

### 完整分页与旧响应隔离

- 每次读取成员页和任务页均携带同一分析／计算／候选身份及 memberIds、projectIds、start、end 等视图范围，仅改变相应 offset；服务端先按范围筛选，再计数与分页。
- 两类游标全部读完并合并后才提交展示。逐页检查 analysisId/snapshotId 一致和游标不重复，异常时提示重开，不能拼接不同快照或将第一页当作完整结果。
- 每次接收新展示输入递增 generation；异步返回及最终提交前均核对代数，卸载后禁止提交，防止旧查询覆盖新范围。新范围加载时清空旧视图，避免旧结果冒充当前选择。

源码：[设置表单](../apps/mcp-ui/src/FormalSettings.vue)、[变更 patch](../apps/mcp-ui/src/settings-model.ts)、[存储合并](../apps/server/src/storage.ts)、[分页与代数](../apps/mcp-ui/src/Analysis.vue)、[服务端视图](../apps/server/src/business-tools.ts)。[2026-11-04 报告](../artifacts/report/20261104_2225_teamsight-mcp-apps-ux_测试报告.md)记录 SDK 浏览器保存及重开；本次未重现沙箱阻拦或原生宿主完整交互，也未重跑组件测试。

## 历史记录：Tauri 前端测试

## 依赖与启用方式

- 依赖：`@vue/test-utils` + `jsdom`。
- **不需要**把全局 `test.environment` 改成 jsdom；按文件在首行加注释即可，其余文件仍跑 node 环境（更快）：

```ts
// @vitest-environment jsdom
```

## 挂载页面的三个要点

1. 页面用到路由时，用 `global.stubs` 替掉 `<RouterLink>`，避免引入整套 router：

```ts
mount(BoardPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
```

2. 需要模拟 Tauri 运行时（让 `isTauriRuntime()` 为真）时，**不要替换全局 `window`**（会破坏 jsdom 提供的 document/localStorage），改为补丁属性、用完删除：

```ts
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
```

3. `onMounted` 里有多层 `await` 时，挂载后要多次 `await flushPromises()` 才能断言异步加载结果。

## 模拟 Tauri 命令与部分模块

- 模拟命令层：`vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))`，在实现里按 `command` 名分派返回值（例如 `settings_read`、`credential_status`）。
- 只替换某个函数、保留真实传输层：使用带 `importOriginal` 的工厂，避免手工补全整个模块的导出：

```ts
vi.mock('@/services/tapd/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tapd/client')>()),
  fetchScheduleTasks: fetchScheduleTasksMock,
}));
```

## 两个容易踩的坑

- 若被测模块在**模块作用域**读取 `import.meta.env`（例如构建期开关），静态 `import` 会被提升到 `vi.stubEnv(...)` 之前；必须先 `vi.stubEnv('VITE_X', '1')`，再用顶层 `await import()` 动态引入该模块。
- 组件只上报事件、状态由父级持有时（例如折叠展开由页面持有），测试要三步走：点击 → 断言 `emitted('toggle-member')` → `wrapper.setProps(...)` 模拟父级更新；只点击不会看到 UI 变化。

## 已验证的组件测试覆盖清单

页面级（BoardPage）：默认时间范围为当前自然月、筛选后列表更新、点击任务显示详情与正确外链、筛选为空显示空状态、部分数据源失败仍保留成功数据并提示、整体失败显示错误、凭据读取失败提示。

组件级（GanttBoard）：成员标题行不显示任务条、任务独占一行、折叠隐藏任务行、展开恢复且后续成员行位移等于折叠行数 × 行高。

## 路由保活测试与共享状态清理

> 验证日期：2026-10-14；2026-10-16 经用户授权提升。

- 验证 KeepAlive 生命周期时使用真实 memory Router 挂载应用，执行路由切换，检查请求次数、页面状态、隐藏期间工作及卸载清理；普通页面单测仍可使用 RouterLink stub。
- 组件测试若共享模块状态，必须在用例结束时卸载页面。遗留 watch 会响应后续用例的状态变化，消耗单次 mock 响应，导致用例互相干扰。

证据：src/app/App.spec.ts、src/pages/BoardPage.spec.ts；artifacts/report/20261014_1442_route-keepalive_测试报告.md。

## 指针事件测试与桌面验收

> 验证及授权提升日期：2026-10-16；版本边界：本项目当前 jsdom 与 Vue Test Utils 2.5.1 组合。

- `trigger('pointerdown', { button: 0, clientX, clientY })` 在该组合中尝试赋值 PointerEvent 从 MouseEvent 继承的只读属性，报 `Cannot set property button ... which has only a getter`。可构造 `new MouseEvent(type, { bubbles: true, cancelable: true, ...init })`，通过 `Object.defineProperty(event, 'pointerId', { value })` 补充指针身份，再 `dispatchEvent` 并 `await nextTick()`。这是测试环境适配，不替代真实指针事件验收。
- 组件测试单独 mock `setPointerCapture`、`hasPointerCapture`、`releasePointerCapture`、`document.elementFromPoint` 与目标行边界；命中测试补丁用后恢复，组件结束时卸载。
- 排序测试覆盖目标前／后插入提示、释放时重新命中、取消、其他 pointerId 不提交、轻微移动／自身／列表外释放不保存，以及保存失败后重试。
- HTML5 drag/drop 的模拟事件测试通过，不代表 Tauri WebView 实际拖动可用。桌面交互改动需用最终生产包实际拖动并核对保存与重启持久化，平台范围见 [桌面知识](tauri-desktop-notes.md)。

证据：src/pages/SettingsPage.spec.ts；artifacts/report/20261016_1553_member-drag-fix_测试报告.md、artifacts/report/20261016_1553_member-drag-fix.log。原 HTML5 方案模拟测试通过却未发现桌面无法提交；最终指针实现的 321 项回归与 macOS 桌面验收通过。
