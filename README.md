# TeamSight

TAPD 跨项目团队排期看板（阶段0 技术验证）。

## 当前状态

阶段0：已完成工程初始化、甘特图 PoC 与 TAPD 接口能力验证。
完整看板功能（筛选、详情、凭据安全存储、打包）属于阶段1–4，尚未实现。

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

## 凭据配置

在仓库根目录创建 `.env.local`（已被 `.gitignore` 忽略，禁止提交）：

```text
PERSONAL_TOKEN=<TAPD 个人令牌>
WORKSPACE_IDS=<项目 ID，逗号分隔>
```

阶段0 使用 Bearer 认证；令牌不会进入前端打包产物，桌面端由 Rust 进程读取。
正式版本（阶段1）会改为操作系统凭据存储（Keychain）。

## 阶段0 验收入口

打开 PoC 页面后按页面底部「阶段0 视觉验收清单」逐项核对；
接口能力结论见 `artifacts/report` 下的测试报告。
