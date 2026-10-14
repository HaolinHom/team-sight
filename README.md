# TeamSight

TAPD 跨项目团队排期看板。

## 当前状态

阶段4：已补齐组件测试、异常与边界加固、性能压测、令牌泄漏审计、macOS 打包与文档。
功能范围覆盖成员分组排期看板、筛选、完成态视觉、预估工时与「打开 TAPD」，以及独立每日工时矩阵、实际不足／预计排期预警和可配置工时规则。
已知边界（未排期任务、Windows 打包、代码签名、虚拟滚动）见手册第 9 节。

## 环境要求

- Node.js 22+ 与 pnpm 10+
- Rust 工具链（`rustup default stable`），仅 Tauri 桌面端需要

## 命令

```bash
pnpm install        # 安装依赖
pnpm tauri:dev      # 启动桌面端（唯一可拉取真实数据的运行环境）
pnpm dev            # 浏览器中运行界面（默认 http://localhost:5183，仅界面调试）
pnpm test           # 单元测试 + 组件测试
pnpm build          # 类型检查 + 前端生产构建
pnpm verify:tapd    # 只读验证 TAPD 接口能力（需 .env.local）
pnpm verify:secrets # 令牌泄漏审计
pnpm tauri:build    # 桌面端打包（.app 与 .dmg）
```

## 使用流程

1. 打开「设置」页，粘贴并保存 TAPD personal token（提示「测试连接」可在桌面端验证）。
2. 点击「读取我的 TAPD 项目」，添加需要的项目并勾选启用（新增项目默认禁用）。
3. 点击「加载成员候选」，搜索并添加要展示的成员。
4. 打开「看板」页：按当前自然月自动加载，仅展示已配置成员的任务；
   用顶部筛选条收窄视图（时间范围会重新拉取，项目/成员/状态只作用于已获取数据）。

每日工时：导航「工时」查看成员 × 日期矩阵；「设置 → 工时统计」可修改每日规定工时（默认 8 小时），并配置日历例外、成员豁免和结束状态。

## 文档

- 完整手册（配置、使用、构建打包、故障排查、只读约束、验收命令）：[docs/用户手册.md](docs/用户手册.md)
- 技术方案：[docs/TAPD 跨项目团队排期看板 — 技术方案.md](<docs/TAPD 跨项目团队排期看板 — 技术方案.md>)
- 各阶段方案与测试报告：`artifacts/plan`、`artifacts/report`

## 凭据（开发期）

桌面端凭据存放在应用配置目录（本地文件、权限 0600），应用内即可保存；开发期脚本可继续使用仓库根目录的
`.env.local`（已被 `.gitignore` 忽略，禁止提交），该文件仅对 debug 构建生效。

```text
PERSONAL_TOKEN=<TAPD 个人令牌>
WORKSPACE_IDS=<项目 ID，逗号分隔>
```

## 视觉与性能验收

在浏览器中启用固定数据执行（对齐、折叠、滚动、筛选交互）：

```bash
VITE_BOARD_FIXTURE=1 pnpm dev       # 固定验收数据
VITE_BOARD_FIXTURE=stress pnpm dev  # 2000 条压测数据
```

### 工时性能

工时请求在 Rust 后台线程执行，统计在 Web Worker 中计算。加载会显示阶段进度；切换范围复用 1 分钟内的完整查询缓存，点击「刷新」会重新获取。超过 2000 个成员日期格时使用可见区域渲染，长明细按需展开。

可用 `node scripts/verify-hours-performance.mjs` 复查计算基准，构建后用 `node scripts/verify-hours-worker.mjs` 验证生产 Worker。
