# Agent Operating Protocol

## Startup

在开始任何工作之前，先按顺序执行下述步骤:

1. 完整读取本文件.
2. 读取 `rules/index.yaml`，并加载所有的规则.
3. 读取 `knowledge/index.yaml`，将所有的子索引文件 `knowledge/index/*-index.yaml` 读取出来，并且不加载具体的知识.

## workflow

1. 理解需求
2. 根据需求内容，从知识索引中找出合适的知识并加载进上下文
3. 按 `rules/test.md` 生成方案，等待方案确认
4. 当方案被确认后，按照方案进行代码落地
5. 代码生成结束后，执行对照测试，按 `rules/test.md` 生成测试报告
6. 按 `rules/knowledge.md` 判断是否需要生成知识候选