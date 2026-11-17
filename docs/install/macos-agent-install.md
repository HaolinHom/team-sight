# macOS：复制给 Agent 的 TeamSight 安装说明

适用 Apple Silicon macOS。当前安装脚本和两个 0.3.4 Release 资产必须先发布、仓库必须公开；本次仅准备本地产物，未创建 Git 提交；下方 PUBLISH_COMMIT_BEFORE_USE 是待发布占位，发布前不能直接使用。公开下载及接收端 Codex 验收状态见测试报告。

将下面整段话与命令一起复制给 Agent：

> 请安装 TeamSight 0.3.4 external 精简版。执行下面固定命令：先通过 HTTP GET 下载官方 install.sh，验证 SHA-256 后运行。由脚本完成发行包下载、原生检查、登录后后台启动和 Codex 配置。不要自行改写安装流程，不要输出访问令牌、TAPD 凭据或完整 Codex 配置。完成后报告服务与 MCP 验证结果，以及 Codex 是否需要重新连接。TAPD 凭据由我在设置卡片填写。

```sh
(
  set -eu
  install_work=$(/usr/bin/mktemp -d)
  trap '/bin/rm -rf "$install_work"' EXIT
  /usr/bin/curl --disable --fail --show-error --silent --location \
    --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 \
    "https://raw.githubusercontent.com/HaolinHom/team-sight/PUBLISH_COMMIT_BEFORE_USE/scripts/install.sh" \
    --output "$install_work/install.sh"
  printf '%s  %s\n' "344ebbd5cb474482f48c50a67b597f1ee90b5e89104b23d6169fce1fa894f86b" "$install_work/install.sh" | /usr/bin/shasum -a 256 -c -
  /bin/bash "$install_work/install.sh" --version 0.3.4 --variant external
)
```

精简版需要现有 arm64 Node >=22.14.0、<23、Node-API >=10；找不到时，可以在最后一行追加 `--node /绝对路径/node`。脚本不安装系统 Node，也不修改 nvm。

自带运行时版：把最后一行的 `--variant external` 改成 `--variant bundled`，其余命令相同。脚本未指定包类型时默认 bundled，无需安装 Node、npm、pnpm 或 GitHub CLI，不需要 GitHub Token。

## 安装结果与维护

- 程序：`~/Library/Application Support/TeamSight MCP/versions/0.3.4-<variant>`；数据：同级 `data-mcp`；日志：同级 `logs`；受保护备份：同级 `backups`。
- 服务通过用户级 `cn.teamsight.mcp` LaunchAgent 立即及登录后启动，关闭终端后继续运行。未登录桌面会话、系统权限或钥匙串提示可能需要用户本人操作。
- Codex 配置只更新 TeamSight 连接，尊重 CODEX_HOME，自动写入仅本机可读的 Authorization Bearer，不要把配置文件或备份发到聊天。服务验证成功不等于当前 Codex 对话已重载工具；按输出重新连接或重启 Codex，再调用 teamsight_status 并打开设置。
- 查询状态／卸载：重新执行上面的下载与校验步骤，将最后一行替换为 `/bin/bash "$install_work/install.sh" --status` 或 `/bin/bash "$install_work/install.sh" --uninstall`。卸载保留数据和系统钥匙串凭据。
- 同一版本可以重复安装或切换包类型。检测到活动作业、待发送写入、未知进程／锁、手工维护的旧 LaunchAgent 或不支持的数据格式时停止并说明原因；不要删除锁或结束未知进程。旧的手工安装须先按原方式安全停止，再处理旧启动项，不能直接覆盖。
- 若提示 INSTALLER_LOCKED，先确认没有安装进程；异常断电留下的安装锁需要人工核对，脚本不会自动清理未知锁。

## 维护者发布步骤

本次未创建脚本快照、未提交或推送。正式发布时先执行 pnpm mcp:installer:prepare 生成固定提交地址及完整说明；下方推送命令在本地准备阶段不可使用。

```sh
git push origin PUBLISH_COMMIT_BEFORE_USE:refs/tags/macos-installer-344ebbd5cb47
```

在私有／随后公开的 GitHub Release `v0.3.4` 上传现有两份 macOS tar.gz 以及 SHA256SUMS-darwin-arm64.txt，不重新压缩、不覆盖已有资产。仓库公开由维护者操作。安装器使用以下固定资产名：

- teamsight-mcp-0.3.4-darwin-arm64-bundled.tar.gz
- teamsight-mcp-0.3.4-darwin-arm64-external.tar.gz

发布后以未登录、无 GitHub 凭证的 HTTP GET 校验脚本及两份压缩包，并在另一台 macOS 上验证完整安装和 Codex 连接，之后再把本说明作为已上线入口发送。

脚本 SHA-256：`344ebbd5cb474482f48c50a67b597f1ee90b5e89104b23d6169fce1fa894f86b`。维护者修改源码后执行 `pnpm mcp:installer:build`、测试及 `pnpm mcp:installer:prepare`，同步生成新快照、地址和哈希；不要手工编辑生成的 install.sh。
