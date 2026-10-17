# 前端测试接入：Vue 3 + Vitest 组件测试

> 验证时间：2026-10-11｜验证方式：本项目阶段4 实际接入（组件测试 7 项全部落地并通过）

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
