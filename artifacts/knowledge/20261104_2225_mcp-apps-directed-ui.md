# MCP Apps 定向界面与沙箱保存（知识候选）

建议提升目标：knowledge/teamsight-server-runtime-notes.md、knowledge/frontend-testing-notes.md。尚未写入正式 knowledge；需要用户确认后提升。

已验证事实：

- 0.2.1 的设置入口接受 target；明确项目配置只渲染项目表单，普通打开显示分类入口。甘特卡片仅保留任务／工时模式，范围与候选由对话确定。
- UI 仅提交改动字段，存储层按 hours、chinaCalendar、tapd 和 writeAccess 子字段合并，并保持 expectedRevision 校验。局部对象不能直接替换整个持久化对象。
- 未包含 allow-forms 的隔离 iframe 中，原生表单提交不会执行保存链路。显式 type:button 加 click 调用保存、保存前 reportValidity 的方式已通过真实 SDK 浏览器保存和重开验证。
- 分页读取每一页必须携带相同的视图范围；合并全部成员／任务页后再展示，并用请求代数丢弃旧响应。
- 新 Apps 使用 settings-0.2.1.html／analysis-0.2.1.html，旧 p1b 资源保留。当前对话可能仍缓存旧工具参数；刷新工具目录或新开对话后使用新入口契约。
- 以上浏览器验证不能替代 Codex 原生宿主验收；Windows 当前只有构建和依赖结构检查。

依据：artifacts/report/20261104_2225_teamsight-mcp-apps-ux_测试报告.md。
