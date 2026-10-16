# Tauri 2 桌面能力：外部链接与后台命令

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
