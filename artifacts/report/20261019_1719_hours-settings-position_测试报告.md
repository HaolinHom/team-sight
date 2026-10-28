# 每日规定工时配置位置调整测试报告

## Summary

将设置页“每日规定工时 x 小时”输入行移至“工时统计”标题正下方，位于说明文字和中国日历配置之前。输入框移出原 fieldset 后显式绑定 `:disabled="busy"`，保留保存期间禁用行为。

## Results

- 源码对照：输入行紧随“工时统计”标题；原位置已移除，无重复输入；数据绑定、保存和校验逻辑未改动。
- 在 iTerm 执行 `pnpm test -- src/components/hours/HoursSettingsCard.spec.ts src/pages/SettingsPage.spec.ts`，实际运行全量 35 个测试文件，359 项全部通过，退出码 0。
- `git diff --check` 通过，退出码 0。

## Issues

未发现问题。

## Not Tested

未执行浏览器或桌面端视觉验收；位置通过模板结构对照确认。

## Artifacts

- 修改文件：`src/components/hours/HoursSettingsCard.vue`。
- iTerm 测试及差异核对日志：`artifacts/report/20261019_1719_hours-settings-position.log`。
- 本次为局部配置项位置调整，无需生成知识候选。
