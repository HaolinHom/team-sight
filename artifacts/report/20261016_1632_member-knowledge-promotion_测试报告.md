# 成员排序与拖拽候选知识提升核对报告

## Summary

按用户“沉淀候选知识”的授权，将成员顺序及指针拖拽两份候选合并到正式 knowledge，并同步索引。仅修改知识文档；用户原有用户手册修改保持不变。

## Results

- 对照当前源码及原测试报告，确认 members 数组顺序、按工号移动、看板 memberOrder、工时输入顺序、查询键与计算键分离的契约。
- 对照 SettingsPage 实现及测试，确认指针捕获、坐标命中、释放重算、取消清理，以及测试环境只读属性适配方法。
- 保留原证据边界：321 项回归与 macOS 桌面拖拽已在修复轮验证；其他操作系统及触摸设备未实测。本轮未重新运行这些测试。
- 正式知识更新至 frontend-reliability-notes.md、frontend-testing-notes.md、tauri-desktop-notes.md；两个相关索引已更新摘要与标签。
- 两份候选内容已全部处理，原候选文件已删除。
- iTerm 中执行的 `git diff --check`、候选不存在断言及正式内容检索通过，脚本退出码为 0。

## Issues

未发现知识与当前源码冲突；未将 HTML5 拖放故障泛化为所有 Tauri 平台限制，也未将未证实的原生拦截机制写为唯一根因。

## Not Tested

本轮为知识提升，无业务代码变更，未重新运行单元测试或生产构建；引用原报告中的已完成验证及限制。

## Artifacts

- 正式知识：`knowledge/frontend-reliability-notes.md`、`knowledge/frontend-testing-notes.md`、`knowledge/tauri-desktop-notes.md`
- 索引：`knowledge/index/frontend-testing-index.yaml`、`knowledge/index/tauri-desktop-index.yaml`
- 核对日志：`artifacts/report/20261016_1632_member-knowledge-promotion.log`
- 原证据：`artifacts/report/20261016_1530_member-order_测试报告.md`、`artifacts/report/20261016_1553_member-drag-fix_测试报告.md`
