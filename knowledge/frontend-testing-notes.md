# MCP Apps 前端与 Vue 组件测试

> 适用版本：MCP 0.3.0。2026-11-06 按源码复核。历史 Tauri 页面、路由、拖拽及运行时 mock 已退役，不再作为当前测试约定。

## 工程与测试入口

Vue、Vue Test Utils、jsdom、Vitest、Vite 由 `apps/mcp-ui/package.json` 自身声明并解析，根包不声明 Vue。避免将 UI 测试依赖分散到根包造成 Vue 测试运行时分裂。

根 `pnpm test` 转发全部 MCP 回归；UI 单独运行 `pnpm --filter @teamsight/mcp-ui test`，构建运行 `pnpm --filter @teamsight/mcp-ui build`。隔离 SDK 浏览器入口为 `apps/mcp-ui/test/preview-mcp.mjs`，Vite 从 UI 包解析。

## 沙箱中的保存链路

SDK 隔离 iframe 缺少 allow-forms 时，原生表单提交曾被阻拦。当前设置页以 `type="button"` 的 click 显式调用 save，保存前执行 `form.reportValidity()`，保留浏览器字段校验。页面仍有 submit.prevent 绑定，不能以原生 submit 作为唯一保存入口。

桥接调用前通过 JSON 序列化生成普通参数，避免直接传递 Vue 响应式对象。`settingsPatch` 只提交修改字段；服务端分层合并 hours、chinaCalendar、tapd 及 writeAccess 子字段，并校验 expectedRevision。局部对象不能覆盖整个配置；修订冲突保留草稿，重新读取后再处理。现行设置范围见[配置知识](teamsight-mcp-config-scope.md)。

## 完整分页与旧响应隔离

- 每次读取成员页和任务页均携带同一分析／计算／候选身份，以及 memberIds、projectIds、start、end 等视图范围，仅改变相应 offset；服务端先按范围筛选，再计数与分页。
- 两类游标全部读完并合并后才提交展示。逐页检查 analysisId、snapshotId 一致且游标不重复，异常时提示重开，不能拼接不同快照或将第一页当作完整结果。
- 接收新展示输入时递增 generation；异步返回和最终提交前均核对代数，卸载后禁止提交。新范围加载时清空旧视图，防止旧结果冒充当前选择。
- 甘特图卸载时清理 ResizeObserver、定时器和滚动／窗口监听；模式或分析数据变化时关闭旧详情及提示。

## 源码与验收边界

- [设置表单](../apps/mcp-ui/src/FormalSettings.vue)、[变更 patch](../apps/mcp-ui/src/settings-model.ts)、[存储合并](../apps/server/src/storage.ts)。
- [分页与代数](../apps/mcp-ui/src/Analysis.vue)、[服务端视图](../apps/server/src/business-tools.ts)、[图层清理](../apps/mcp-ui/src/GanttLayers.vue)。
- [设置测试](../apps/mcp-ui/src/FormalSettings.spec.ts)、[分析测试](../apps/mcp-ui/src/Analysis.spec.ts)、[图层测试](../apps/mcp-ui/src/GanttLayers.spec.ts)、[模型测试](../apps/mcp-ui/src/gantt-model.spec.ts)。
- [2026-11-04 报告](../artifacts/report/20261104_2225_teamsight-mcp-apps-ux_测试报告.md)记录沙箱保存问题及浏览器验证；[0.3.0 实施报告](../artifacts/report/20261106_退役Tauri与旧兼容_mcp030_测试报告.md)记录该版本回归及隔离浏览器结果。历史测试数量不作为当前测试状态。
- 组件测试、隔离 SDK 浏览器和 Codex 原生 Apps 属不同验收范围。本轮为知识静态核对，未重跑 UI 测试或原生宿主完整交互。
