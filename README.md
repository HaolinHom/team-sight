# TeamSight MCP

TeamSight 是连接 TAPD 与 AI 助手的本地 MCP 服务。你可以在 Codex 等支持 MCP 的工具中，通过自然语言查看个人工作、分析团队排期与工时、评估交付风险，并在授权范围内创建任务、调整排期和发表评论。

TeamSight 从 TAPD 获取工作事实，提供计算、图表与文件；AI 助手负责理解需求、组织分析和解释结果。服务运行在本机，设置与甘特图通过 MCP Apps 卡片展示。

## 核心功能

| 功能 | 使用方式 |
| --- | --- |
| 工作查询 | 查询需求、任务、缺陷、关联任务、评论及可访问的历史与附件信息 |
| 工时与风险分析 | 汇总实际工时、剩余预计工作量与每日容量，识别超负荷、工时不足、缺失排期和数据缺口 |
| 团队甘特图 | 按成员展示任务与每日工时，在任务优先、工时优先两种模式间切换 |
| 普通排期 | 根据估时、负责人、容量、依赖和截止节点，计算正排或倒排候选 |
| 紧急需求模拟 | 比较直接承接、调整已有研发任务和多人协作的可行性及影响 |
| TAPD 写入 | 创建或修改需求与任务、批量创建及补排期，为需求、任务、缺陷发表评论或回复 |
| 报告与导出 | 导出 Markdown、HTML、CSV、JSON 报告，以及 SVG、PNG、HTML 甘特图 |

## 环境要求

当前版本为 **0.3.4**，发行目标为 **macOS Apple Silicon（arm64）** 和 **Windows x64**。

- **AI 工具**：支持 Streamable HTTP MCP；设置与交互式甘特图还需要 MCP Apps 支持。以下以 Codex 为接入示例，其他宿主需自行确认兼容性。
- **TAPD 账号**：具有所需项目访问权限的个人访问令牌。
- **网络**：本机可访问 TAPD；自动安装还需访问 GitHub，节假日日历更新需访问对应数据源。

发行包提供两种版本：

| 版本 | 运行要求 | 适用情况 |
| --- | --- | --- |
| bundled（推荐） | 自带私有 Node.js 22.23.4，无需安装 Node 或 pnpm | 日常使用 |
| external（精简版） | 已安装同平台 Node.js >=22.14.0 且 <23，Node-API >=10 | 已维护兼容 Node 环境 |

bundled 不安装全局 Node，也不修改系统 PATH 或 nvm。其他系统、架构及宿主的支持状态见[平台说明](docs/validation/teamsight-mcp-platforms.md)。

## 安装与连接

### 方式一：使用发行包

从 [GitHub Releases](https://github.com/HaolinHom/team-sight/releases) 获取维护者已发布的对应平台压缩包及 SHA-256 清单。若所需版本尚未发布，请向维护者获取发行包，或按[源码开发](#源码开发)自行构建；仓库中的安装说明不代表所有平台资产均已上线。

| 平台 | 推荐压缩包 |
| --- | --- |
| macOS Apple Silicon | `teamsight-mcp-0.3.4-darwin-arm64-bundled.tar.gz` |
| Windows x64 | `teamsight-mcp-0.3.4-win32-x64-bundled.zip` |

精简版使用同名 `external` 包。先核对压缩包的 SHA-256 与发行清单一致，再完整解压到可写目录。以下命令以 bundled 为例，在压缩包所在目录执行。

**macOS**

~~~sh
shasum -a 256 teamsight-mcp-0.3.4-darwin-arm64-bundled.tar.gz
# 与随发行包提供的 SHA256SUMS 清单中对应项逐字比较，一致后继续
tar -xzf teamsight-mcp-0.3.4-darwin-arm64-bundled.tar.gz
cd teamsight-mcp-darwin-arm64-bundled
./launch.sh doctor
./launch.sh serve --data-dir "$HOME/Library/Application Support/TeamSight MCP/manual-data" --port 43127
~~~

**Windows（PowerShell）**

~~~powershell
Get-FileHash .\teamsight-mcp-0.3.4-win32-x64-bundled.zip -Algorithm SHA256
# 与随发行包提供的 SHA256SUMS 清单中对应项逐字比较，一致后继续
Expand-Archive .\teamsight-mcp-0.3.4-win32-x64-bundled.zip -DestinationPath .\TeamSight
Set-Location .\TeamSight\teamsight-mcp-win32-x64-bundled
.\launch.ps1 doctor
.\launch.ps1 serve --data-dir "$env:LOCALAPPDATA\TeamSight MCP\manual-data" --port 43127
~~~

上述服务在前台运行，使用期间保持终端打开。`doctor` 检查本机 SQLite、系统凭据库和图片生成环境，全部通过后启动服务。Windows 使用现有 PowerShell 执行策略；后台安装要求 PowerShell 7，步骤见[服务管理](apps/server/README.md#windows-后台安装)。

在 Codex 中添加 MCP HTTP 连接：

- 地址：`http://127.0.0.1:43127/mcp`。
- 认证：使用本次 `--data-dir` 目录下 `access-token` 文件中的**本机访问令牌**，配置为 Bearer 认证。
- 手动修改 Codex 配置时，参见[认证配置](apps/server/README.md#codex-认证配置)；使用令牌环境变量时，必须确保 Codex 宿主进程能读取它，仅在服务终端设置变量不会自动传递给桌面应用。

保存连接并重新连接或重启 Codex，再发送“检查 TeamSight 服务状态”。需要管理前台服务时，在另一个终端使用相同包、相同数据目录执行 `launch.sh status|stop --data-dir …`，Windows 对应 `launch.ps1`；完整命令见[服务管理](apps/server/README.md#服务管理)。

### 方式二：让 Agent 自动安装

macOS Apple Silicon 用户可以使用 [Agent 自动安装说明](docs/install/macos-agent-install.md)。安装器下载并校验发行包，配置登录后后台运行的服务和 Codex 连接，关闭安装终端后服务仍可使用。默认推荐 bundled，也可选择 external。

**当前自动下载说明含待发布地址占位，尚不能直接用于安装。** 维护者发布固定脚本地址与对应 Release 资产，并确认匿名下载可用后，才能复制其中的指令交给 Agent。安装完成后按输出重新连接 Codex，并检查服务状态。

Windows 当前提供发行包运行和本地后台安装器，没有同等的 HTTP 自动下载安装入口。

## 首次配置

连接成功后，在对话中发送：

> 打开 TeamSight 的 TAPD 连接设置。

1. **连接 TAPD**：在设置卡片中填写 TAPD 个人访问令牌并保存。服务会同步可访问项目和当前用户；同步不完整时可通过对话重新同步。
2. **检查项目**：打开项目设置，保留需要纳入分析的项目。同步新增项目默认启用，后续同步保留已有启停、别名、颜色和排序。
3. **配置团队**：个人查询可直接使用当前账号；团队查询前需添加成员、建立分组并设置默认分组。新安装的默认分组为空，发现成员不会自动加入团队。
4. **核对计算规则**：检查每日规定工时、完成状态以及节假日与调休设置。新安装默认每日 8 小时，启用中国节假日与调休；完成状态需按项目实际状态配置。
5. **检查写入权限**：连接设置中可调整允许的操作及修改字段。0.3.4 新安装默认允许创建、修改、发表评论，以及名称、描述、负责人、预估工时、开始日期、结束日期、关联需求、任务状态八个标准字段。仅需查询时，可关闭写入操作。

已有安装保留原有选择，升级不会自动补开已关闭或缺失的写入权限、日历设置。实际写入始终受启用项目范围、允许操作、字段规则和 TAPD 账号权限约束。

TAPD 令牌仅在设置卡片中填写并保存至系统凭据库；它与本机 MCP 访问令牌用途不同，均不应粘贴到对话中。

## 使用示例

在对话中说明人员、项目、日期范围和预期结果即可。涉及具体需求或任务时，提供 TAPD 链接；涉及估时与排期时，补充工作量、负责人和交付约束。

| 场景 | 示例指令 |
| --- | --- |
| 个人工作 | 查看我本周的任务、已填工时和未排期工作，列出数据缺口。 |
| 团队甘特图 | 打开默认团队本月的排期甘特图，并查看工时优先视图。 |
| 交付风险 | 分析默认团队未来两周的超负荷、缺失日期和交付风险，说明判断依据。 |
| 需求排期 | 读取这个 TAPD 需求，按前端 8 小时、后端 16 小时，倒排到下周五联调，先给出候选方案。 |
| 紧急需求 | 这项紧急工作预计 12 小时、下周三截止，比较直接承接和调整已有排期的影响，先只模拟。 |
| 创建与补排期 | 按刚才确认的普通排期方案创建关联任务，并逐项返回 TAPD 链接与写入结果。 |
| 评论与回复 | 读取这项需求的评论，然后发布评论“接口联调已完成，等待测试验收”。 |
| 报告导出 | 基于刚才同一份分析导出 Markdown 工时报告和 PNG 甘特图。 |

甘特图卡片提供任务／工时模式切换与详情查看；人员、项目、日期范围、候选比较和导出通过对话指定。普通排期计算本身不写入 TAPD，紧急需求模拟始终只读。更详细的流程与工具说明见[能力与使用说明](docs/TeamSight-MCP-能力与使用说明.md)。

## 数据与权限

- **本地存储**：配置、分析、文件和操作回执保存在本机数据目录，TAPD 凭据保存在系统凭据库。服务仅监听 `127.0.0.1`，请求需要本机 Bearer 认证；查询时由本机服务访问 TAPD，返回的业务内容进入所使用的 AI 宿主。
- **来源与完整性**：分析保留来源时间和数据完整性。已保存分析是查询时的快照，需要最新结果时应明确要求刷新；取数失败或缺口不会当作零工时。
- **容量与风险**：结果依赖 TAPD 中的估时、日期、实际工时和日历。未分配容量不能直接证明成员空闲，排期候选也不承诺全局最优。
- **写入结果**：创建、修改和评论返回持久化回执。结果未知时应先查询并核实，避免重复提交；批量操作逐项检查，不提供跨任务事务。
- **附件**：支持读取附件信息并按需获取临时下载链接，不提供附件上传。

## 源码开发

使用 Node.js **22.23.4** 和 pnpm **10.12.4**，在仓库根目录执行：

~~~sh
git clone https://github.com/HaolinHom/team-sight.git
cd team-sight
pnpm install --frozen-lockfile
pnpm build
pnpm test
node apps/server/dist/cli.js doctor
pnpm mcp:serve --data-dir .local/teamsight-mcp --port 43127
~~~

构建发行包使用 `pnpm mcp:package darwin-arm64`、`pnpm mcp:package win32-x64` 或 `pnpm mcp:package all`，产物位于 `artifacts/releases/0.3.4`。开发环境、平台依赖、迁移和发布准备见[服务文档](apps/server/README.md)。

## 文档

- [能力与使用说明](docs/TeamSight-MCP-能力与使用说明.md)：配置、分析、排期、写入和工具接口。
- [macOS Agent 自动安装](docs/install/macos-agent-install.md)：安装前提、可复制指令及安装维护。
- [服务管理与故障排查](apps/server/README.md)：认证、后台服务、升级、数据迁移与开发。
- [平台与宿主验收](docs/validation/teamsight-mcp-platforms.md)：平台验证方法及能力边界。

当前使用以以上文档为准；历史手册、方案及报告仅记录对应版本。
