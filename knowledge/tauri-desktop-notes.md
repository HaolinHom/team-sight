# Tauri 2 桌面能力：外部链接、后台命令与内部拖拽

> 历史适用范围：独立 Tauri App 已于 MCP 0.3.0（2026-11-06）退役；本文保留旧桌面实现与验收记录，不作为当前 MCP 的安装、凭据或构建指南。当前约定见[运行知识](teamsight-server-runtime-notes.md)。

> 验证时间：2026-10-10｜验证方式：桌面端实测（修复「点击打开 TAPD 无反应」缺陷）＋ 插件源码与构建产物核对

## 现象与根因

- 在 Tauri webview 中，`<a href="https://..." target="_blank">` 被点击后**没有任何反应，也不报错**。
- 根因：webview 不处理新窗口/外链跳转，默认能力集（`core:default`）也不包含任何外部打开权限，点击被静默吞掉。

## 正确做法（已验证）

1. 依赖：Rust 侧 `tauri-plugin-opener = "2"`，前端 `@tauri-apps/plugin-opener`。
2. 注册：`tauri::Builder::default().plugin(tauri_plugin_opener::init())`。
3. 调用：桌面端先 `event.preventDefault()` 再 `await openUrl(url)`；浏览器模式保留原生 `<a>` 新标签行为。
4. 能力按最小作用域授权（`capabilities/*.json`）：

```json
{
  "identifier": "opener:allow-open-url",
  "allow": [{ "url": "https://www.tapd.cn/*" }]
}
```

5. 作用域匹配用 `glob::Pattern::matches`（`MatchOptions::new()`，`require_literal_separator = false`），因此 `*` **可跨 `/` 匹配**，`https://www.tapd.cn/*` 能命中 `https://www.tapd.cn/tapd_fe/<id>/task/detail/<task_id>`。
6. 构建期会生成 `src-tauri/gen/schemas/capabilities.json`：其中包含目标权限即说明标识与作用域格式被 Tauri 接受，可用于排查「配置写错导致静默失败」。

## 实践约定

- 外部链接统一封装为 `openExternalUrl()`：协议白名单（仅 https）+ 桌面端走插件 + 浏览器端 `window.open(url, '_blank', 'noopener,noreferrer')`。
- 打开失败必须把错误显示到界面；否则该能力失效时表现为「点了没反应」，极难排查。
- 不要用修改 `window.location` 的方式跳转外链——那会把 webview 导航离开应用本体。

## 阻塞请求必须移出主线程

> 验证日期：2026-10-14；2026-10-16 提升并核对当前实现。

- 当时本机 tauri-macros 2.7.1 的 src/lib.rs:48～56 说明同步 command 可能阻塞主线程；wrapper.rs 的 Blocking 分支直接调用函数，Async 分支通过 respond_async_serialized 执行。此结论有版本边界，升级后应重核。
- 前端 invoke 返回 Promise 不会解除原生命令内部的同步阻塞。原 tapd_get 使用同步 command 和阻塞 ureq 请求，是桌面假死的排查重点。
- 当前 tapd_get 为 async command，凭据读取与阻塞 HTTP 放在 tauri::async_runtime::spawn_blocking 中；也可采用真正的异步 HTTP，但不能把大量阻塞请求直接放进异步运行时。
- 前端统一请求队列并发上限为 3；取消尚未执行的请求会将其移出队列，已经开始的 HTTP 不能立即中断。
- 工时纯 TypeScript 计算放入 module Web Worker；现有 Tauri 传输函数依赖 window，不能未经适配直接在 Worker 调用。Worker 生命周期及结果保护见 [前端可靠性知识](frontend-reliability-notes.md)。

证据：src-tauri/src/lib.rs、src/services/tapd/client.ts、src/services/tapd/requestQueue.ts；artifacts/report/20261014_1355_hours-performance_诊断报告.md、artifacts/report/20261014_1400_hours-performance_测试报告.md。原验证包含 241 项前端用例、4 项 Rust 用例、生产 Worker 与真实 TAPD 缓存核对；未测量桌面精确输入延迟。

## 内部拖拽排序与实际输入验证

> 验证及授权提升日期：2026-10-16；实测平台：macOS Tauri 生产包。

- 本项目设置页原 HTML5 drag/drop 排序通过模拟事件测试，但桌面实际拖动未能可靠提交。不能由此推断所有 Tauri 平台均不支持 HTML5 拖放，也未将特定原生拦截机制确认为本次唯一根因。
- 当前内部排序使用 Pointer Events 与 `setPointerCapture`，不依赖系统原生拖放流程；手柄禁用原生拖动与文本选择，`touch-action: none`。macOS 最终生产包实测向前、向后、跨多行移动与重启后的顺序持久化均成功，无需修改 Tauri 窗口拖放配置。
- 捕获期间事件 currentTarget 仍是源手柄，目标应按 `document.elementFromPoint(clientX, clientY)` 找到同一列表的成员行，以行中点判断 before／after；pointerup 时重新命中，避免沿用过时提示。
- 用 pointerId 隔离拖动，设置最小移动距离避免点击误提交；pointercancel、lostpointercapture、Escape 及卸载时清理。释放捕获前先清空内部状态，防止释放引起的取消事件干扰已确定的提交。
- 真实验收应从本次构建的绝对 `.app` 路径启动，避免误测旧安装包；检查顺序更新及重启持久化，并恢复测试前的用户配置。

证据：src/pages/SettingsPage.vue、src/pages/SettingsPage.spec.ts；artifacts/report/20261016_1553_member-drag-fix_测试报告.md、artifacts/report/20261016_1553_member-drag-fix.log。Windows、Linux、触摸屏及触控笔未实测；取消事件和写入失败由组件测试覆盖。
