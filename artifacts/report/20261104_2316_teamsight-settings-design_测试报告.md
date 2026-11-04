# TeamSight MCP 设置页重设计测试报告

## Summary

按已确认的定向设置交互，重新设计设置页布局、排版、各类控件和反馈状态，主色保留 rgb(235,115,45)。版本为 0.2.2。使用 frontend-design 技能形成设计方案、自评并通过浏览器截图复查。

本轮不修改甘特图、排期算法及 TAPD 写入业务。初始工作树为空，无 Git 提交。方案见 [设置页设计方案](../plan/20261104_2252_teamsight-settings-design.md)。

## Results

| 范围 | 结果 |
| --- | --- |
| 服务构建 | TypeScript 构建通过 |
| UI 构建 | vue-tsc 与三个独立 singlefile 入口构建通过 |
| UI 组件测试 | 3 个文件，16 项通过；其中设置页 9 项 |
| 服务测试 | 31 项通过 |
| 单文件资源 | settings.html 无外部 script src、modulepreload link 或相对 import；资源包含新分类和控件 |
| 范围隔离 | analysis.html 与 0.2.1 逐字节一致，SHA-256 为 c441bfb6afc116741dc87e4b43e7440fef501aedc209f48ef5725cdf5b1b38c7 |
| 工时控件 | 步长 0.5、上界24；8h → 8.5h 保存成功，分类摘要同步更新；保存仅提交修改字段 |
| 项目配置 | 隔离宿主内添加项目、别名、颜色、启停保存后重开正确；行内展开与删除确认通过，排序保留既有逻辑 |
| 成员与分组 | 成员对齐列表与身份/分组信息正确；分组独立多选、保存、新分组展开、唯一默认组通过 |
| 草稿与异常 | 旧成功消息随新编辑清除；取消恢复草稿；修订冲突保留编辑；同步前保护未保存内容；初始化不完整时不恢复原请求 |
| 定向配置 | 直接打开 projects、hours、write 时只显示对应表单；从分类进入可返回分类 |
| 视觉复查 | 项目、行内编辑、成员、分类、工时、写入范围已截图；420px 窄屏单列无横向溢出；深色成员页文字/表单可读；媒体与viewport模拟已恢复 |
| macOS 运行包 | doctor 通过 SQLite、系统凭据库和 PNG 检查；隔离 MCP 验证通过，45个工具，TAPD POST为0 |
| Windows 运行包 | 打包成功；原生模块使用旧包校验缓存，未实测Windows |
| 本机升级 | 已复制至 versions/0.2.2，2130个文件 SHA-256 核对无差异；health和MCP状态均为0.2.2 |
| 升级兼容 | 配置 revision16、9个项目、5位成员、credentialPresent=true；本地访问令牌未变；新settings-0.2.2资源包含新布局；0.2.1和p1b资源别名保留 |
| 静态检查 | git diff --check 无输出 |

## Issues

截图检查发现通用输入规则优先级覆盖工时组合输入的边框和字号，已通过 :where 降低通用选择器优先级修复，并重新构建、截图验证。

预览宿主原固定 iframe 高度无法完整承载长表单，已接入 SDK onsizechange，并调整最小高度。该修改仅影响隔离测试宿主。

Vite 构建仍有 Zod 上游 PURE 注释位置警告，不影响产物输出。未发现阻塞交付的问题。

## Not Tested

- Codex 原生 Apps 完整交互未完成：已通过现有 MCP 连接调用设置入口，但当前自动化没有可访问的原生 Apps tab；浏览器 SDK 宿主与协议验证不能替代此项。
- Windows 实机、Windows Codex Apps、Linux、DeepSeek Harness 未测试。
- 未使用真实 TAPD 创建或修改任务；所有 UI 保存验证在隔离配置及内存凭据库完成，真实服务只读核验。
- 未重新运行旧 Tauri App 全量回归，本轮不改其入口或共享计算。
- 深色和窄屏为代表性页面验证，未穷举每种表单组合。

## Artifacts

- [截图与日志](./20261104_settings-design/)
- [项目列表](./20261104_settings-design/projects.png)
- [项目行内编辑](./20261104_settings-design/project-editor.png)
- [420px 窄屏](./20261104_settings-design/projects-narrow.png)
- [分类入口](./20261104_settings-design/overview.png)
- [深色成员页](./20261104_settings-design/members-dark.png)
- [运行包验证结果](./20261104_settings-design/runtime/mcp-acceptance.json)
- 新运行包位于 artifacts/releases/teamsight-mcp-{darwin-arm64,win32-x64}，压缩包和 SHA256SUMS.txt 同目录；旧0.2.1已归档至 artifacts/releases/0.2.1。
- 本机升级前数据和启动脚本备份：/Users/haolin/Library/Application Support/TeamSight MCP/backup-0.2.1-20261104-settings。

本轮为设置页面局部设计和控件调整，未新增需要独立沉淀的业务知识，不生成知识候选，不修改正式knowledge。
