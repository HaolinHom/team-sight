# 设置页精简与项目范围统一测试报告

## Summary
实现已确认方案，版本0.2.3。设置页从11类缩减为7类；TAPD连接集中账号、查询类型及写入操作/字段；项目启停统一默认查询与写入范围；MCP忽略历史请假。保留配置数据、旧资源和入口兼容，旧Tauri默认算法不变。

初始工作树为空，本轮没有Git提交、推送或公开发布。交付包括本地运行包和已安装服务更新。

## Results

| 范围 | 结果 |
| --- | --- |
| 完整构建 | pnpm mcp:build 通过，包含core/tapd/server及UI类型检查与三个singlefile入口 |
| 包级测试 | core 14、TAPD 10、server 34，全部通过 |
| UI组件测试 | 18项通过，其中设置页11项；包含7分类、迁入字段、局部保存、自定义字段读回、草稿保护及修订冲突 |
| 默认项目范围 | 旧查询及写入名单设为obsolete后，启用项目仍可查询、创建；新同步启用项目可执行已有允许操作 |
| 写入校验 | 停用项目拒绝创建/修改，不可访问项目拒绝写入；操作与字段限制仍生效；批量逐项返回停用失败与启用成功；元数据读取期间停用项目阻止POST |
| 显式读取 | 停用项目仍可读取详情及需求上下文 |
| MCP请假规则 | 历史6h请假不再扣减8h目标；leaveHours为0、容量为8h；普通6h任务可在当天完整安排，单人紧急8h可行，模拟POST为0；原请假记录保留 |
| 兼容计算 | legacy计算仍扣减请假并遵循日历；MCP新结果使用teamsight-mcp-hours-v3，旧v2分析文件原目标和规则可读、不被重算覆盖 |
| 设置目标兼容 | write/general→connection，leave/import→overview，真实MCP协议及本机服务已核对 |
| 浏览器保存往返 | 隔离SDK宿主内修改查询类型、创建操作及字段列表并保存，重开后选中状态与custom_field_one均保留；令牌未重新填写 |
| 视觉验证 | 七类入口、浅色连接页、420px窄屏、深色连接页截图检查通过；临时viewport/媒体模拟已恢复 |
| 资源隔离 | 设置HTML无外部script src、modulepreload link和相对import；analysis.html与0.2.2逐字节一致 |
| macOS运行包 | doctor通过SQLite、系统凭据库与PNG检查；隔离MCP验证45个工具，配置初始化、普通排期、紧急模拟通过，真实TAPD POST为0 |
| Windows运行包 | 打包通过，原生依赖复用经哈希校验的0.2.2缓存；未进行Windows实机运行 |
| 安装升级 | versions/0.2.3的2130个文件校验无差异；health及MCP状态为0.2.3，新设置资源可读 |
| 配置保留 | 升级前后配置SHA-256相同，revision23、9项目、5成员、credentialPresent=true；本地访问令牌未变 |
| 静态检查 | git diff --check通过；隔离预览服务已关闭，业务服务保持运行 |

新安装仍不默认开放写入操作。既有操作/字段选择未被本轮升级改写；项目范围按新规则实时取启用且可访问项目。

## Issues
移除旧导入表单后，类型检查发现页尾残留的import判断，已删除并重新通过完整构建。Vite仍报告Zod上游PURE注释位置警告，产物正常生成。未发现阻塞交付的问题。

## Not Tested
- Codex原生Apps完整交互未验收。浏览器SDK宿主和MCP协议结果不能替代原生宿主验收。
- Windows实机/原生Codex Apps、Linux、DeepSeek Harness未测试。
- 未向真实TAPD创建或修改任务。写入规则测试使用隔离传输；浏览器操作使用隔离配置及内存凭据库。
- 未运行旧Tauri UI全量回归；通过核心legacy规则测试验证请假及日历默认行为保持。
- 深色/窄屏验证针对本轮连接页和分类入口，未穷举其余未改表单。

## Artifacts
- [实施方案](../plan/20261105_teamsight-settings-simplify.md)
- [截图及测试日志](./20261105_settings-simplify/)
- [七类入口](./20261105_settings-simplify/overview.png)
- [连接页](./20261105_settings-simplify/connection.png)
- [窄屏](./20261105_settings-simplify/connection-narrow.png)
- [深色](./20261105_settings-simplify/connection-dark.png)
- [运行包验证](./20261105_settings-simplify/runtime/mcp-acceptance.json)
- [正式知识](../../knowledge/teamsight-mcp-config-scope.md)：原候选已于2026-11-05经用户明确授权提升并登记索引，候选文件已清理。
- 新包：artifacts/releases/teamsight-mcp-darwin-arm64.zip及teamsight-mcp-win32-x64.zip；SHA256SUMS.txt同目录。0.2.2旧包已归档artifacts/releases/0.2.2。
- 升级前数据和启动脚本备份：/Users/haolin/Library/Application Support/TeamSight MCP/backup-0.2.2-20261105-settings-simplify。
