# Rust/Tauri 工具链与网络注意事项

> 历史适用范围：独立 Tauri App 已于 MCP 0.3.0（2026-11-06）退役；本文保留旧桌面实现与验收记录，不作为当前 MCP 的安装、凭据或构建指南。当前约定见[运行知识](teamsight-server-runtime-notes.md)。

> 验证时间：2026-10-10（工具链与凭据）、2026-10-11（打包与审计脚本）｜环境：macOS 26.7（Apple Silicon）、Node 22、pnpm 10.12.4

## 安装 Rust 工具链

- 官方源 `static.rust-lang.org` 在本网络下极慢（实测约 2–8 MB/分钟，20 分钟仍未完成）。
- 切换镜像后约 40 秒完成安装：

```bash
export RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static
export RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh
sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain stable
```

- 该镜像配置仅用于安装过程，未写入仓库；如需长期生效应由开发者自行写入本机 `~/.cargo/config.toml`。

## crates.io 与编译耗时

- 首次 `tauri dev` 需拉取索引并编译约 353 个 crate，实测首次约 15 分钟（瓶颈在索引拉取）。
- 增量编译约 3.5 秒；`src-tauri/target` 首次编译后约 1.2 GB，已在 `.gitignore` 中忽略。

## Tauri 2 注意事项

- 即使 `bundle.active = false`，`tauri::generate_context!` 仍要求存在 `src-tauri/icons/icon.png`，缺失会导致编译期报 `failed to open icon ...`。生成方式：`pnpm tauri icon <1024x1024 源图>`。
- 开发模式下 Rust 进程的工作目录是 `src-tauri/`，读取仓库根配置需使用 `../<文件名>`；发布版不适用该相对路径。
- `tauri dev` 会通过 `beforeDevCommand` 自行启动前端 dev server；若已有进程占用 `devUrl` 端口（本项目 5183）会启动失败，需先释放端口。
- 开发二进制没有 bundle id，自动化工具无法按应用名绑定窗口；**打包后的 `.app` 有 bundle id**，可按 bundle id 绑定窗口读取界面树与截图（见下节），这是验证打包产物真实可用性的最有力手段。

## 打包与分发（macOS）

- 只设 `bundle.active = false` 时 `tauri build` 仅产出裸二进制；要产出可分发的 `.app`/`.dmg` 需要：

```json
"bundle": {
  "active": true,
  "targets": ["app", "dmg"],
  "category": "Productivity",
  "shortDescription": "...",
  "longDescription": "..."
}
```

- 产出位置：`src-tauri/target/release/bundle/macos/<Product>.app` 与 `bundle/dmg/<Product>_<version>_<arch>.dmg`；本项目实测 `.app` 12.72 MiB、`.dmg` 3.59 MiB。
- 未签名但**本机构建**的 `.app` 可直接 `open` 启动（没有下载隔离属性，Gatekeeper 不拦）；分发给他人时才需要右键「打开」或 `xattr -dr com.apple.quarantine <App>`。Windows 侧对应 SmartScreen「仍要运行」。
- `.dmg` 验证方式：`hdiutil attach -nobrowse -quiet <dmg>` 挂载 → 检查内含 `.app` 与 `Applications` 软链 → `hdiutil detach -quiet /Volumes/<name>` 卸载。
- 发布版行为差异：不读取仓库根 `.env.local`（受 `cfg(debug_assertions)` 限制），凭据必须来自应用内保存的文件或环境变量。

## 令牌泄漏审计脚本

- 思路：读取 `.env.local` 的令牌，逐文件比对内容；用 `readFileSync(file, 'latin1')` 可同时覆盖文本与二进制（例如 `.app` 内的可执行文件），按 64MB 上限跳过超大压缩包。
- 扫描范围建议覆盖 `dist/`、`src-tauri/target/release/`、`README.md`、`docs/`、`artifacts/`：本项目实测约 3200 个文件、耗时数秒；发现即非零退出。
- 配套核对两条设计约束：release 不读 `.env.local`；桌面端不写前端存储（localStorage 仅浏览器开发模式使用）。

## 应用配置目录与本地凭据（阶段1）

- `app_config_dir()` 在 macOS 上为 `~/Library/Application Support/<identifier>/`（本项目 identifier 为 `com.haolinhom.team-sight`）；配置与凭据都写在这里，不进仓库。
- 凭据文件权限用 `std::os::unix::fs::PermissionsExt` 设为 `0600`，写入采用「临时文件 + rename」避免半截文件（Rust 单测已覆盖，含权限断言）。
- 令牌解析顺序：应用内保存的凭据文件 → 环境变量 `TAPD_PERSONAL_TOKEN` → 仓库根 `.env.local`（仅 debug 构建）。
- 当前凭据为本地明文文件，属已知临时取舍；技术方案 §4.3 要求最终切换系统钥匙串，届时只需替换 Rust 侧读写实现。
- 浏览器模式无法直连 TAPD（原因见 `tapd-api-auth-and-errors.md` 的跨域小节），只能用于界面调试，真实数据必须经桌面端加载。
