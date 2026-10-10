# TeamSight

TAPD 跨项目团队排期看板。

## 当前状态

阶段2：正式看板主视图（`/board`）已交付——成员分组、任务独立成行、日级网格、
项目颜色、折叠展开、滚动对齐、任务条即时提示与详情入口。
凭据当前保存在本机应用配置目录的本地文件（明文、权限 0600），后续会替换为系统钥匙串。
筛选、完整任务详情与交互体验优化属于阶段3，尚未实现。

## 环境要求

- Node.js 22+ 与 pnpm 10+
- Rust 工具链（`rustup default stable`），仅 Tauri 桌面端需要

## 命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 浏览器中运行界面（默认 http://localhost:5183）
pnpm test           # 单元测试（日期、布局、映射、分页、配置、提示、状态）
pnpm build          # 类型检查 + 前端生产构建
pnpm verify:tapd    # 只读验证 TAPD 接口能力（需 .env.local）
pnpm tauri:dev      # 启动 Tauri 桌面端
```

## 使用流程

1. 打开「设置」页，粘贴并保存 TAPD personal token（提示「测试连接」可在桌面端验证）。
2. 点击「读取我的 TAPD 项目」，添加需要的项目并勾选启用（新增项目默认禁用）。
3. 点击「加载成员候选」，搜索并添加要展示的成员。
4. 打开「看板」页：进入时按当前自然月自动加载；仅展示已配置成员的任务，
   同一任务有多个已配置负责人时会在每个成员分组下各占一行。
   悬停任务条显示即时提示，点击任务条或左侧标题可在底部信息条查看要点并「打开 TAPD」。

## 凭据配置

在仓库根目录创建 `.env.local`（已被 `.gitignore` 忽略，禁止提交）：

```text
PERSONAL_TOKEN=<TAPD 个人令牌>
WORKSPACE_IDS=<项目 ID，逗号分隔>
```

令牌解析顺序：应用内保存的凭据文件 → 环境变量 `TAPD_PERSONAL_TOKEN` → `.env.local`（仅 debug 构建，
供验证脚本与自动化使用）。令牌不会进入前端打包产物，桌面端由 Rust 进程读取。

浏览器模式（`pnpm dev`）无法直连 TAPD：预检不支持 `Authorization` 头，且方案禁止把令牌放入 URL，
因此真实数据必须在桌面端加载；浏览器里的令牌仅保存在 localStorage 供界面调试。

## 验收入口

视觉验收（对齐、折叠、滚动）可在浏览器中启用固定数据执行：

```bash
VITE_BOARD_FIXTURE=1 pnpm dev   # 打开 /#/board，加载固定验收数据，不请求 TAPD
```

真实数据在桌面端 `pnpm tauri:dev` 中查看。
接口能力结论见 `artifacts/report` 下的测试报告。
