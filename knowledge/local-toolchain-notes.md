# Rust/Tauri 工具链与网络注意事项

> 验证时间：2026-10-10｜环境：macOS 26.7（Apple Silicon）、Node 22、pnpm 10.12.4

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
- 开发二进制没有 bundle id，自动化工具无法按应用名绑定窗口；需要自动验证前端到 Rust 的链路时，可用环境变量开关触发启动即加载真实数据。
