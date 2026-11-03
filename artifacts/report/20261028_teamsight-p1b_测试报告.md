# TeamSight P1b 测试报告

## Summary

按已确认的技术方案 v1.2、分阶段执行方案及 P1b 实施方案验证需求/任务读写、共享分析核心、风险、Apps 与文件产物。本轮范围为 P1b；P0、P1a 已由用户确认通过，未进入 P1c。

环境为 macOS arm64、Node.js 22.23.4、Node-API 10、pnpm 10.12.4。构建、自动化测试及 Node 验证脚本通过 iTerm 执行并保存日志，浏览器操作保存截图和结构化证据。真实写入仅使用用户指定项目 `62119705`，验收使用独立数据目录 `.local/teamsight-p1b-live`，未替换已有 Codex MCP 配置。

结论：P1b 已完成实现，33 项包级自动化测试、旧 App 386 项回归、构建、真实需求/任务创建修改、六格式资源读取及 SDK 浏览器分析视图验证通过。2026-10-29，当前 Codex 原生工具调用成功，用户确认分析卡片可见并已放到侧边展示。**原生卡片交互、宿主文件呈现及 P1b 设置新增表单保存往返尚待人工验收，不能将本阶段记为全面验收通过。** 当前停在 P1b 确认点。

## Results

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm p1b:build` | PASS，core/tapd/server 通过 TypeScript 检查；三入口 Apps 自包含构建 | `final-p1b-tests.log` |
| `pnpm p1b:test` | PASS，core 7、tapd 9、server 17，共 33 项，0 失败 | `final-p1b-tests.log` |
| 旧 App `pnpm test` | PASS，36 个文件、386 项，0 失败 | `legacy-regression.log` |
| 旧 App `pnpm build` | PASS，类型检查与 Vite 构建；最终代码再次构建通过 | 上述两个日志 |
| 凭据检查、`git diff --check` | PASS，产物/文档/代码及最终证据未发现被比对凭据明文，差异格式检查通过 | `final-checks.log`、`credential-audit.json` |
| 实际 TAPD 创建/修改 | PASS，需求和任务各一个，POST 表单发送后读回验证 | `live-acceptance.json`、`live-acceptance.log` |
| 重启后只读复核 | PASS，4 个成功回执、2 个远端对象、原分析及 6 个文件保持一致；额外 TAPD 写入 0 次 | `restart-recheck.json`、`restart-recheck.log` |
| SDK 浏览器 Apps | PASS，甘特、每日工时、风险依据、8 项明细、CSV 生成及预览，无界面错误 | 4 张浏览器截图、`browser-export.json` |
| Codex 原生卡片 | PARTIAL，原生工具调用及用户确认侧边卡片显示通过；交互、文件呈现与设置保存往返待人工验收 | [原生卡片补充报告](./20261029_teamsight-p1b-native-host_测试报告.md) |

自动化重点覆盖：

- 旧入口 re-export 共享工时、日历、请假和布局；业务时区、非法日期/范围、成员顺序、小时请假、节假日、当天只报告进度、未知数据不产生确定不足风险。
- 字符串长 ID、201 条完整分页、重复页/畸形响应、50 页预算、count 与短页不一致、需求 offset 换算、并发上限 3、读取有限重试、真实 HTTP POST 表单与断连写入仅发送一次。
- 固定目录与统一 Schema、禁止额外 URL/Header 和未登记操作；项目/字段限制、身份候选、修改摘要冲突；同键并发重放、参数冲突的明确错误码。
- 超时或读回缺失保留 `unknown`；只读核对、在途回执重启恢复、不自动重发；正常写入使缓存失效，已保存分析保持不可变。
- 每日实际与截至分析日累计分别读取，累计不按当前负责人筛选；部分/全部失败、完整缓存保留来源时间、别名/规则变动复用快照、作业取消与重启中断。
- HTML/SVG 转义、CSV 公式注入防护、真实中文 PNG、按日期及实际成员任务行分页；MCP 工具、Apps 单文件资源、产物链接及资源读取。

真实写入与分析：

| 对象 | 远端 ID | 结果 |
| --- | --- | --- |
| [验收需求](https://www.tapd.cn/tapd_fe/62119705/story/detail/1162119705001212279) | `1162119705001212279` | 创建、修改标题、读回通过 |
| [验收任务](https://www.tapd.cn/tapd_fe/62119705/task/detail/1162119705001212280) | `1162119705001212280` | 创建并关联上述需求、修改标题、读回通过 |

两个对象均带有 `TeamSight P1b 验收 2026-10-28` 标记，更新后标题以“（更新已验证）”结尾，保留供用户复查，未删除。重启复核只读取既有回执和对象，未再次创建或修改。

真实分析 ID 为 `ec2f9653-5e90-4cf1-9e8a-f95c89886fe4`，快照 ID 为 `7164ce0e-8fa2-4d3a-afda-20a4f7520554`；范围 2026-10-28 至 2026-11-04、时区 Asia/Shanghai。状态 `complete`，配置成员范围内取得 8 个工作项、1 个成员、5 条风险、0 个取数问题。这里的完整仅指声明的成员/项目覆盖，不包含无负责人扫描。

PNG、SVG、Markdown、HTML、CSV、JSON 六种产物均引用该分析与快照，并实际经 MCP 资源读取。重启后 MIME、SHA-256 及原始来源时间仍一致。PNG 已目视核对中文、标题和排期布局；浏览器 CSV 预览包含中文列名与完整 8 天记录。

## Issues

已修复的问题：

1. TAPD 会在单人 `owner` 返回值末尾补 `;`。首次需求创建实际已成功，原样读回比较使回执保留 `unknown`。现按账号列表归一化（去空项、排序），工时数值也规范化；使用原操作 ID 只读核对恢复成功，再继续修改，未重复创建。
2. 三个 Apps 入口改为各自自包含构建，避免多入口共享 chunk 留下运行时文件依赖；设置/分析资源使用 P1b URI。
3. 通用目录与常用工具改用同一参数契约；修复 `.omit()` 的 TypeScript 联合类型调用，构建通过。
4. 分页短页与已取得的 count 不一致时降为部分数据；补齐需求 offset 换算、幂等键冲突错误码和日期校验。界面补上成员/工作项/风险分页及问题、待安排条目截断提示。

当前限制：

- 本服务稳定幂等键不能保证 TAPD 远端恰好一次；没有远端原子 CAS 时，修改摘要只降低并发覆盖风险。未知结果必须先核实，不能直接换键重发。
- 任务状态来自已登记的 TAPD 文档固定表；需求使用项目元数据。未登记字段、对象和操作不在覆盖内。
- 分析覆盖配置成员，不扫描无负责人；需求不参与 task/bug 工时汇总。没有历史快照时不推断历史排期变动或期间完成量。
- 读取上限 200 条/页、50 页；静态甘特按 30 天及 30 个实际成员任务行分图，最多 200 页并检查像素预算。超限须缩小范围；最大负载 PNG 渲染响应时间未做性能验收。
- 构建存在依赖包中 `@__PURE__` 注释位置的 Rollup 提示，不影响构建成功。

## Not Tested

- 2026-10-29 补测：当前 Codex 实际连接名为 `teamsight_p0_probe`，地址为 P1b 的 43129；首次初始化 HTTP 502，重连后原生 `teamsight_status` 返回 P1b，`teamsight_open_analysis` 返回上述固定分析；用户已确认卡片可见并已放到侧边展示。详见 [原生卡片连接诊断报告](./20261029_teamsight-p1b-native-host_测试报告.md)。
- **真实 Codex 原生 Apps 交互及宿主文件呈现**：卡片显示已确认，成员/范围筛选、图表/工作项明细、风险依据展开、导出与宿主文件预览、P1b 设置卡片新增表单保存往返仍待人工操作确认。此前原生界面工具返回 `Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.`，因此没有自动操作原生界面，也没有换技术绕过限制。SDK AppBridge 浏览器检查不能代替这些原生交互验收。
- 真实 TAPD 侧超时、权限故障、并发覆盖或写后断连未故意制造；这些失败边界由隔离传输与本地 HTTP 场景验证，不能视为 TAPD 提供额外保证。
- 浏览器实测样本为 1 个成员、8 个工作项；多人、多页布局已自动化验证，实际大团队及最大 PNG 负载未实测。
- Windows/Linux、真实 Bundle 安装、首版发行、完整配置迁移、宿主定时/无人值守、休眠离线补跑、旧 App 退役未执行；P1c 相关项仍按原阶段门槛推进。当前没有提交、发布或部署。

## Artifacts

- [技术方案](../plan/20261027_2341_teamsight-server-mcp-apps-technical-plan.md)、[分阶段执行方案](../plan/20261028_teamsight-v1.2-phased-implementation.md)、[P1b 实施方案](../plan/20261028_teamsight-p1b-implementation.md)。
- [服务使用说明](../../apps/server/README.md)、[真实验收脚本](../../apps/server/verify-p1b.mjs)。
- [证据目录](./20261028_teamsight-p1b_evidence/)：`final-p1b-tests.log`、`legacy-regression.log`、`live-acceptance.log`、`restart-recheck.log`、`final-checks.log`、`credential-audit.json`；真实验收/重启复核 JSON、六类文件与浏览器截图。
- 验收服务：`http://127.0.0.1:43129/mcp`，隔离目录 `.local/teamsight-p1b-live`。SDK 临时浏览器宿主：`http://127.0.0.1:43130/`，不属于产品网站或发行物。

主要复查命令（Node.js 22.23.4 / pnpm 10.12.4）：

```sh
pnpm p1b:build
pnpm p1b:test
pnpm test
pnpm build
pnpm verify:secrets apps packages
git diff --check
node apps/server/dist/cli.js status --data-dir .local/teamsight-p1b-live
```
