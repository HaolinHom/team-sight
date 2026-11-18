// Create a content-addressed, script-only Git snapshot without changing HEAD/index.
// Publication remains an explicit maintainer step; repository visibility is never changed.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const script = await readFile(root + '/scripts/install.sh')
const hash = createHash('sha256').update(script).digest('hex')
function git(args, input) {
  const result = spawnSync('git', args, { cwd: root, input, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-10T00:00:00Z' } })
  if (result.status !== 0) throw new Error('INSTALLER_GIT_SNAPSHOT_FAILED')
  return result.stdout.trim()
}
const localOnly = process.argv.includes('--local-only')
let commit = null
if (!localOnly) {
  const blob = git(['hash-object', '-w', '--stdin'], script)
  const scriptsTree = git(['mktree'], '100755 blob ' + blob + '\tinstall.sh\n')
  const tree = git(['mktree'], '040000 tree ' + scriptsTree + '\tscripts\n')
  commit = git(['commit-tree', tree], 'TeamSight macOS installer snapshot ' + hash + '\n')
  git(['update-ref', 'refs/teamsight/installers/' + hash, commit])
}
const tag = 'macos-installer-' + hash.slice(0, 12)
const url = 'https://raw.githubusercontent.com/HaolinHom/team-sight/' + (commit ?? 'PUBLISH_COMMIT_BEFORE_USE') + '/scripts/install.sh'
const command = [
  '(', '  set -eu', '  install_work=$(/usr/bin/mktemp -d)', '  trap \'/bin/rm -rf "$install_work"\' EXIT',
  '  /usr/bin/curl --disable --fail --show-error --silent --location \\',
  '    --proto \'=https\' --proto-redir \'=https\' --connect-timeout 10 --max-time 60 \\',
  '    ' + JSON.stringify(url) + ' \\', '    --output "$install_work/install.sh"',
  '  printf \'%s  %s\\n\' ' + JSON.stringify(hash) + ' "$install_work/install.sh" | /usr/bin/shasum -a 256 -c -',
  '  /bin/bash "$install_work/install.sh" --version 0.3.4 --variant bundled', ')',
].join('\n')
const doc = [
  '# macOS Agent 自动安装',
  '',
  '适用版本：**0.3.4**，仅支持 **macOS Apple Silicon（arm64）**。安装器下载发行包、验证完整性、配置登录后后台服务及 Codex 连接。推荐 bundled 自带运行时版，不需要预装 Node、npm、pnpm、源码或 GitHub CLI。',
  '',
  '手动运行发行包见[项目 README](../../README.md#安装与连接)，服务维护见[服务文档](../../apps/server/README.md)。',
  '',
  '## 安装前提',
  '',
  localOnly
    ? '**发布状态：待发布。** 本说明由本地准备模式生成，下载地址含 `PUBLISH_COMMIT_BEFORE_USE` 占位，尚不能用于安装。下方命令仅供维护者核对，发布前不要执行或复制给 Agent。'
    : '**发布前提：** 下方地址固定到脚本快照提交；生成本说明并不代表该提交和发行资产已上线。维护者必须先完成本文末尾的发布与匿名下载核验，再提供给使用者。',
  '',
  '- 安装脚本及对应 GitHub Release 资产须公开可下载，网络可访问 GitHub，无需 GitHub Token。',
  '- 使用当前用户的 macOS 桌面登录会话；钥匙串或系统权限提示由用户本人处理。',
  '- bundled 使用私有 Node 22.23.4；external 需要已有 arm64 Node >=22.14.0 且 <23、Node-API >=10。',
  '- 已有手动服务先按原方式安全停止并处理启动项；安装器不会接管未知进程或手工维护的 LaunchAgent。',
  '',
  '## 安装指令',
  '',
  '发布前提满足后，将下面说明与对应的完整命令一起交给 Agent：',
  '',
  '> 请安装 TeamSight 0.3.4 bundled 自带运行时版。按下方固定命令下载 install.sh，验证 SHA-256 后执行，由安装器完成发行包下载校验、原生检查、后台服务和 Codex 配置。不要输出访问令牌、TAPD 凭据或完整 Codex 配置。完成后报告服务验证和 Codex 是否需要重新连接；TAPD 凭据由我在设置卡片填写。',
  '',
  '~~~' + (localOnly ? 'text' : 'sh'),
  command,
  '~~~',
  '',
  '命令先下载脚本并核对 SHA-256，再执行脚本。安装器继续验证固定版本归档与包内文件；不要跳过校验、改为 latest 或使用 curl 管道直接执行。',
  '',
  '### 使用 external 精简版',
  '',
  '将说明中的版本选择改为 external，并将命令最后一行的 `--variant bundled` 改为 `--variant external`。未找到兼容 Node 时可追加 `--node /绝对路径/node`。安装器将验证并固定该 Node 的真实路径，不修改 nvm 或系统 PATH。',
  '',
  '## 安装后验证',
  '',
  '1. 查看安装器输出，分别确认服务及 MCP 验证、Codex 配置结果。',
  '2. 按提示重新连接或重启 Codex；安装成功不代表当前对话已加载新工具。',
  '3. 在对话中发送“检查 TeamSight 服务状态，打开 TAPD 连接设置”，在卡片填写 TAPD 令牌。',
  '4. 按[首次配置](../../README.md#首次配置)检查项目、成员分组、工时日历、完成状态和写入权限。',
  '',
  '## 安装目录与维护',
  '',
  '安装根目录为 `~/Library/Application Support/TeamSight MCP`：',
  '',
  '| 内容 | 相对安装根目录的路径 |',
  '| --- | --- |',
  '| 程序 | `versions/0.3.4-<variant>` |',
  '| 数据与本机访问令牌 | `data-mcp` |',
  '| 日志 | `logs` |',
  '| 备份 | `backups` |',
  '',
  '服务通过用户级 `cn.teamsight.mcp` LaunchAgent 立即及登录后启动，关闭安装终端后继续运行。Codex 配置尊重 CODEX_HOME，默认使用 `~/.codex/config.toml`；安装器备份并更新 TeamSight 连接，将本机 Bearer 写入受保护的配置，不依赖终端环境变量传递。TAPD 令牌另外保存至系统凭据库。',
  '',
  '使用相同下载与校验步骤，将命令最后一行替换为以下操作即可维护；完整下载命令的发布前提仍然适用：',
  '',
  '- 查询状态：`/bin/bash "$install_work/install.sh" --status`。',
  '- 卸载：`/bin/bash "$install_work/install.sh" --uninstall`。卸载保留数据、访问令牌、备份和系统凭据。',
  '',
  '安装器支持从受管 0.3.3 升级至 0.3.4、同版本重复安装及 bundled／external 切换。活动作业、待发送写入、未知端口／实例／锁或被手动改变的管理文件会阻止切换。遇到 INSTALLER_LOCKED 时先核对安装进程，不盲目删除锁；ROLLBACK_REQUIRED 表示需要根据保留的状态与备份恢复。',
  '',
  '## 维护者发布准备',
  '',
  '本节面向维护者，不是使用者安装步骤。安装器源码或模板变更后，先完成相应构建与验证，再生成说明：',
  '',
  '~~~sh',
  'pnpm mcp:installer:build',
  'pnpm mcp:installer:verify',
  '# 仅更新本地说明；不创建 Git 快照',
  'node scripts/prepare-installer-release.mjs --local-only',
  '~~~',
  '',
  '正式准备发布时执行 `pnpm mcp:installer:prepare`，生成真实固定提交地址。该操作只创建本地脚本快照和说明，不推送、不上传、不改变仓库可见性；说明模板位于 `scripts/prepare-installer-release.mjs`，不要直接修改生成的 install.sh。',
  '',
  localOnly
    ? '当前尚未生成发布快照，不提供可执行的推送命令。完成正式 prepare 后使用新说明中的固定提交与标签。'
    : '检查脚本快照及验证结果后，由维护者发布固定提交：',
  ...(localOnly ? [] : ['', '~~~sh', 'git push origin ' + commit + ':refs/tags/' + tag, '~~~']),
  '',
  '将对应的既有 macOS 归档及 `SHA256SUMS-darwin-arm64.txt` 发布到 GitHub Release `v0.3.4`，不重新压缩或覆盖封存资产，并确保脚本及资产可公开下载：',
  '',
  '- `teamsight-mcp-0.3.4-darwin-arm64-bundled.tar.gz`',
  '- `teamsight-mcp-0.3.4-darwin-arm64-external.tar.gz`',
  '',
  '发布后以未登录、无 GitHub 凭据的 HTTP GET 核对脚本与两份归档哈希，并在接收端 macOS 验证安装、Codex 连接与卡片。核验完成后再分发安装指令。',
  '',
  '脚本 SHA-256：`' + hash + '`。',
  '',
].join('\n')
await mkdir(root + '/docs/install', { recursive: true })
await writeFile(root + '/docs/install/macos-agent-install.md', doc)
await mkdir(root + '/.local/validation/http-installer', { recursive: true })
await writeFile(root + '/.local/validation/http-installer/release.json', JSON.stringify({ commit, tag, sha256: hash, url, localOnly, status: 'prepared-locally; publication and public acceptance pending' }, null, 2) + '\n')
console.log(JSON.stringify({ commit, tag, sha256: hash, guide: 'docs/install/macos-agent-install.md', published: false }))
