> 历史文档：对应旧版本，0.3.0 已退役旧入口。当前运行与迁移请见仓库 README 和 apps/server/README.md。

# TeamSight P0 Windows 验收交接

## 范围与状态

依据技术方案 v1.2 和已批准的 P0 实施计划。当前交付为 **P0 原型**，Windows **待实测**。本文件要求 Windows Codex 验收和记录问题，不进入 P1a，不导入旧 App 配置、不接入真实 TAPD、不执行远端写入。

P0 允许先提交 macOS arm64 实测和本交接文档。Windows 实测必须在 P1c 正式发布及旧 App 退役前补齐。Codex Apps 真闭环若失败，保持 P0，提交证据后讨论适配方向。

## 源码、产物与前提

- 源码基线 HEAD：`6c8e1aa3ec66f6dc64e0b34c97f6f3e7849d22be`；本次实现为该基线上工作区新增内容，**不能只靠 HEAD 识别此次实现**。
- 产品原型版本 `0.0.0-p0`，技术方案 v1.2。产物 `versions.json` 记录确切源码 SHA-256、构建时间、平台、依赖版本；`checksums.json` 记录包内文件 SHA-256（自身除外）。另有压缩包 SHA-256 清单。
- Windows x64：`artifacts/releases/teamsight-p0-win32-x64.zip` 或对应目录。不要使用 macOS arm64 包；Windows arm64、macOS x64、Linux 本轮未验收。
- 外部 Node.js **22.23.4 x64**，pnpm **10.12.4** 仅用于源码构建。运行验证包不需要 pnpm、SQLite CLI、C++ 工具链或下载编译原生模块。
- 驱动：MCP core/server/client 2.4.0、Node adapter 2.1.2、Apps 2.0.4、better-sqlite3 13.0.3、keyring 2.1.2、resvg 2.6.2。以包内完整版本清单为准。
- 记录 Windows 版本、CPU、Node 路径/版本、Node-API、Codex 应用版本和 CLI 版本。凭据管理器必须对当前登录用户可用；中文显示依赖系统中文字体（如 Microsoft YaHei）。

## PowerShell：校验与自动验收

在一个带空格且独立于源码的目录解压，以下路径按实际位置修改。不要运行安装或重建原生模块命令。

```powershell
$p0Root = 'C:\TeamSight P0\teamsight-p0-win32-x64'
$p0Evidence = 'C:\TeamSight P0\evidence'
New-Item -ItemType Directory -Force $p0Evidence | Out-Null
Set-Location $p0Root
Get-Command node | Select-Object Source
node --version
node -p "JSON.stringify({platform:process.platform,arch:process.arch,napi:process.versions.napi})"
Get-Content .\versions.json
$p0Hashes = Get-Content .\checksums.json -Raw | ConvertFrom-Json
foreach ($p0Entry in $p0Hashes.PSObject.Properties) {
  $p0File = Join-Path $p0Root $p0Entry.Name
  if ((Get-FileHash -Algorithm SHA256 $p0File).Hash.ToLowerInvariant() -ne $p0Entry.Value) {
    throw "CHECKSUM_MISMATCH: $($p0Entry.Name)"
  }
}
node .\dist\cli.js doctor 2>&1 | Tee-Object (Join-Path $p0Evidence 'doctor.log')
if ($LASTEXITCODE -ne 0) { throw 'doctor failed; preserve logs, do not rebuild native modules' }
node .\verify.mjs --evidence-dir $p0Evidence 2>&1 | Tee-Object (Join-Path $p0Evidence 'verify.log')
if ($LASTEXITCODE -ne 0) { throw 'automatic acceptance failed' }
```

预期 `doctor` 为 `ok:true`、`platform:win32`、`arch:x64`、Node-API ≥10、SQLite 版本、凭据核对成功和 PNG 大小；`acceptance.json` 为 `ok:true`，两个连接同 PID/实例，重启实例 ID 改变，配置/凭据保持，冲突和保存失败反馈正确。脚本自建并清理测试凭据和临时目录。

**`codexAppsRoundTrip`、`hostScheduler` 显示未由该脚本测试是预期结果**。必须继续以下宿主验收。打开 `probe.png`，目视确认“团队排期 · 工时验证”字形完整、没有方框；保存截图证据。校验清单本身不作为签名信任根，分发时另核对压缩包校验值。

## 启动、Codex 连接与 Apps

第一个 PowerShell 窗口启动服务并保留运行：

```powershell
$p0Data = Join-Path $env:LOCALAPPDATA 'TeamSight\p0-validation'
node .\dist\cli.js serve --data-dir $p0Data --port 43127 2>&1 |
  Tee-Object (Join-Path $p0Evidence 'service.log')
```

这是单个 Node.js 进程，不自动注册为 Windows 服务。端口被占用时更换端口并同步 MCP 地址，禁止结束未知进程。

在宿主 **实际支持的 MCP 配置入口**登记（Codex `config.toml` 通常位于 `$env:USERPROFILE\.codex\config.toml`）：

```toml
[mcp_servers.teamsight_p0]
url = "http://127.0.0.1:43127/mcp"
bearer_token_env_var = "TEAMSIGHT_P0_BEARER"
```

值从 `$p0Data\access-token` 获取，给 **Codex 进程**设置变量，并按宿主要求重启或重连。PowerShell 可以用 `$env:TEAMSIGHT_P0_BEARER = (Get-Content (Join-Path $p0Data 'access-token') -Raw).Trim()` 设置当前进程环境，但已启动的桌面宿主不会因此自动继承。若改用本机 `http_headers` 明文配置，只将令牌留在本机权限受控文件，不贴到对话、日志或提交仓库。保存配置前备份，验收后只移除本次增加的段落，保留既有配置。

目标 Codex 会话内顺序验证，记录时间、结果、截图及错误原文：

1. 发现并调用 `teamsight_status`，记录 PID/instanceId；另开会话调用，必须指向同一进程。
2. 调用 `teamsight_probe_open_settings`；必须在 **Codex MCP Apps** 中看到 Vue 表单，不能用浏览器直开 HTML、Inspector 或别的宿主代替。重开会话和 MCP 连接步骤也要记录。
3. 读取配置修订 r，修改团队名称/工时，保存后得到 r+1，重开显示新值。只填 `TEAMSIGHT_P0_SENTINEL_windows_test` 之类的非真实测试哨兵。
4. 在两张卡片均读到同一 r 后，第一张保存成功；第二张提交必须出现冲突，数据库不得被旧值覆盖。重新读取后可再编辑。
5. 勾选“模拟保存失败”，修改并提交，必须提示失败并保留草稿；重新读取数据库仍是原修订。取消勾选后重试成功。
6. 用同一测试哨兵点击“核对测试凭据”，返回一致；读取工具和状态只返回布尔值。检查工具结果、Agent 可见参数、宿主可获得的调用日志、服务日志、SQLite 和 UI。分别记录可见/不可见/无法访问，**不能因 app-only 元信息便声称宿主完全不记录秘密**。
7. 调用 `teamsight_probe_render`，确认会话内图片实际显示，并保存证据。
8. 第二个 PowerShell 执行 `node .\dist\cli.js stop --data-dir $p0Data`，等原进程退出后按相同命令重启。重新连接 MCP，配置及凭据核对仍成立。
9. 在 Apps 清理测试凭据；核对系统凭据条目清理。若自动脚本清理失败，保留其临时目录和错误，使用对应隔离配置执行清理，不能删除其他用户凭据。

## 真实定时与 Bundle 安装能力

使用 Codex 实际定时任务创建临时 **只读**任务，通过 `status-mcp.mjs <隔离数据目录>` 调用同一服务的 `teamsight_status`，或直接使用已配置的只读 MCP 工具。必须等待一次真实到点运行；保存任务 ID、计划时间、实际时间、工具名、PID/instanceId 和结果。独立执行环境应使用同一登录用户的目录/凭据。手动运行脚本不算调度成功，TeamSight 内部不新增业务定时器。验证后删除临时任务并记录删除结果。

本交付是 JS 验证包，没有声称 Codex 已支持 `.mcpb` 直装。核实当前 Codex 版本是否存在 Bundle 安装入口并实际操作（若可用）；记录支持、失败或未能测试及证据。没有入口或不能安装时，使用上述 HTTP 配置路径，单列限制，不把 ZIP 改扩展名冒充 MCP Bundle。

## 失败诊断与退出

| 现象 | 检查与处理 |
| --- | --- |
| `NODE_MISSING` / node 不在 PATH | `Get-Command node`；配置外部 Node 22.23.4。缺失诊断可运行 `launch.ps1`，如脚本策略阻止执行则记录，不降低系统策略 |
| `NODE_UNSUPPORTED` | 检查 Node 版本、主版本和 Node-API；其他 Node 主版本需另验 |
| `P0_START_OR_NATIVE_FAILED` | 核对目标 x64 包、校验、`.node` 文件、目录权限、Apps 资源；记录模块和原错误诊断，不通过现场编译掩盖交付缺口 |
| `401` | Bearer 是否给到了实际 Codex 进程；不要输出令牌 |
| `403` | 必须用 loopback 地址，Host/Origin 不匹配会拒绝；不关闭校验 |
| `INSTANCE_LOCKED` | 确认隔离目录是否已运行；崩溃后先检查 PID、命令与健康状态，确认退出后才删除该隔离目录的 `instance.lock` |
| Apps 只有文字/打不开/提交无响应 | 保存 Codex 版本、工具元信息、资源 MIME、截图和错误；标记未通过，停留 P0，不改建独立网站 |
| `KEYRING_*` | 当前 Windows 用户的凭据管理器可用性、策略、进程身份；不退回明文保存 |
| 图片中文字缺失 | 记录系统字体、PNG 和截图；在目标系统验证字体策略，不接受仅文件存在 |

使用已安装的不兼容 Node 运行 `dist/cli.js doctor` 验证启动前诊断，不为验收卸载或破坏正常环境。Node 缺失可以在隔离子进程 PATH 中测试。服务正常退出后 `instance.json` / `instance.lock` 应清理，配置库和 MCP token 保留。退出前清理测试凭据、临时宿主任务与新增 MCP 配置。

## 证据记录模板

```text
验收日期与操作者：
Windows / CPU / Codex 应用与 CLI：
Node 路径 / 版本 / Node-API：
产物 versions.json / ZIP SHA-256 / 校验结果：
自动验收、原生凭据、数据库与中文图片：通过 / 失败（证据）
Codex 工具发现与多会话同进程：
Apps 打开、读写、冲突、失败反馈、重开与重启：
哨兵可见范围：UI / 模型参数 / 结果 / 宿主日志 / 服务日志 / SQLite
Bundle 安装实测与替代接入路径：
真实调度 ID / 计划与实际时间 / PID / instanceId / 清理：
Node 缺失、不兼容、服务退出恢复：
未通过项与完整复现步骤：
测试凭据、配置、任务、进程清理结果：
最终结论：通过 / 有限制 / 未通过；不得据此自动开始 P1a
```

## 可直接交给 Windows Codex 的提示词

> 请读取仓库 AGENTS.md 与规则，再按 docs/validation/teamsight-p0-windows.md 验收 TeamSight P0。你的任务仅为验收与记录问题，不进行 P1a 或其他功能实现，不重构、不修复交付缺陷来掩盖问题。核对源码/产物版本与 SHA-256，使用外部 Node.js 22.23.4 x64，在带空格的独立目录运行验证包，完成原生模块、配置/凭据重启、多连接、中文 PNG、Node 诊断与退出恢复。必须在本机目标 Codex 会话实际验证 MCP Apps 配置读写、冲突、失败反馈、重开，核查测试哨兵的可见范围，并完成一次真实宿主定时调用与清理。核实 Bundle 安装入口，无法实测的项目明确标记待执行。仅用隔离目录及测试凭据，不导入旧 App 真配置、不调用真实 TAPD、不执行远端写入。保存可复查日志、截图和 artifacts/report 测试报告；存在宿主或依赖缺口时提交复现与证据并停止，等待用户确认，不进入下一实施阶段。
