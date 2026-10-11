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
