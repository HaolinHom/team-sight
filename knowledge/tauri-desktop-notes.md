# Tauri 2 桌面能力：打开外部链接

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
