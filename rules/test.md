# Test Rules

## When To Create Report

只有当 Agent 实际进行了对照测试后，才需要生成测试报告并保存到根目录下的 `/artifacts/report`。

对照测试包括：

- 按方案或需求进行源码、配置、文档或产物对照检查
- 执行命令、脚本、构建、测试、lint 或类型检查
- 对实现结果进行可复查的静态检查或场景核对

## When Not To Create Report

以下情况不生成测试报告：

- 没有进行对照测试
- 用户只要求讨论、方案设计或简单问答
- 用户明确要求不保存产物

如果没有进行对照测试，不生成 report，只在最终回复中说明未测试原因。

## Report Output

如果进行了对照测试：

1. 根据测试结果生成测试报告
2. 将测试报告保存到根目录下的 `artifacts/report`
3. 在最终回复中说明测试报告路径

## Naming

推荐命名：

```text
artifacts/report/YYYYMMDD_HHmm_{task-slug}_测试报告.md
```

历史 `artifacts/report/*.md` 不迁移、不重命名。

## Template

```md
# {任务名}测试报告

## Summary

说明测试对象和测试方式。

## Results

记录已执行的对照测试及结果。

## Issues

记录发现的问题；没有问题时写明未发现问题。

## Not Tested

记录未测试项、原因和风险。

## Artifacts

记录关联方案、关键文件或命令。
```
