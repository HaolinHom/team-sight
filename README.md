# TeamSight

TAPD 跨项目团队排期看板（阶段0 技术验证）。

## 当前状态

阶段1：已完成请求层、统一任务模型、项目/成员配置管理与成员过滤；
凭据当前保存在本机应用配置目录的本地文件（明文、权限 0600），后续会替换为系统钥匙串。
时间范围/状态筛选、任务详情与正式看板布局属于阶段2–3，尚未实现。

## 环境要求

- Node.js 22+ 与 pnpm 10+
- Rust 工具链（`rustup default stable`），仅 Tauri 桌面端需要

## 命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 浏览器中运行 PoC（默认 http://localhost:5183）
pnpm test           # 单元测试（日期、布局、字段映射、分页）
pnpm build          # 类型检查 + 前端生产构建
pnpm verify:tapd    # 只读验证 TAPD 接口能力（需 .env.local）
pnpm tauri:dev      # 启动 Tauri 桌面端
```

## 使用流程

1. 打开「设置」页，粘贴并保存 TAPD personal token（提示「测试连接」可在桌面端验证）。
2. 点击「读取我的 TAPD 项目」，添加需要的项目并勾选启用（新增项目默认禁用）。
3. 点击「加载成员候选」，搜索并添加要展示的成员。
4. 打开「排期验证」页加载真实数据：仅展示已配置成员的任务；同一任务有多个已配置负责人时，
   会在每个成员分组下各占一行。

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

打开「排期验证」页后按页面底部清单逐项核对布局；
接口能力结论见 `artifacts/report` 下的测试报告。
