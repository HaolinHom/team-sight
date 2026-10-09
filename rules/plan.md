# Plan Rules

## When To Create Plan

只有当 Agent 明确输出了《方案》时，才需要将方案保存到根目录下的 `artifacts/plan`。

适用场景：

- 用户要求生成方案、实施计划、技术方案或落地计划
- Agent 在实施前主动输出方案，并需要按该方案继续落地
- 任务存在多步骤实施，且方案会作为后续执行依据

## When Not To Create Plan

以下情况不保存方案：

- Agent 没有输出《方案》
- 用户只要求简单问答、解释、状态确认或小范围直接修改
- 用户明确要求不保存产物
- 为了保存 artifact 而额外生成本来不需要的方案

## Plan Output

如果需要保存方案：

1. 先生成方案内容
2. 将方案保存到根目录下的 `artifacts/plan`
3. 再按方案进入后续落地流程

## Content Boundary

方案正文只描述业务或技术实施本身，例如目标、范围、实现、测试和假设。

以下内容属于 Agent workflow，不写入业务方案正文，除非用户明确要求输出 workflow 或规则方案：

- 将方案保存到根目录下的 `artifacts/plan`
- 将测试报告保存到根目录下的 `artifacts/report`
- 生成知识候选到根目录下的 `artifacts/knowledge`
- 执行 preflight、落盘、归档等内部流程动作

## Deferred Save

如果 Agent 已明确输出《方案》，但当前协作模式或系统约束禁止写文件，则不应为了说明保存动作而污染方案正文。

保存动作顺延到下一次允许写文件且进入实施阶段时执行，并且必须在任何业务文件修改、代码生成、测试报告写入或知识候选写入之前完成。

## Naming

推荐命名：

```text
artifacts/plan/YYYYMMDD_HHmm_{task-slug}.md
```

历史 `artifacts/plan/*.md` 不迁移、不重命名。

## Template

```md
# {任务名}实施方案

## Summary

说明目标、范围和关键约束。

## Implementation Plan

说明准备如何落地。

## Test Plan

说明计划如何验证。

## Assumptions

说明默认假设和不纳入范围。
```
