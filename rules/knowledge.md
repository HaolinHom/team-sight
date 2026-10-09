# Knowledge Rules

## When To Create Candidate

任务完成后，如果出现以下情况，Agent 应生成知识候选到根目录下的 `artifacts/knowledge`：

- 现有 `knowledge` 缺失，且本次任务验证出了稳定事实
- 现有 `knowledge` 与源码、配置、Swagger 或用户明确指令不一致
- 本次任务总结出了可复用的实现模式、路径映射、工具用法或禁止项
- 该信息未来大概率会被重复使用

## When Not To Create Candidate

以下情况不生成知识候选：

- 单次任务的临时结论
- 未验证的猜测
- 只对当前文件有效的局部细节
- 用户没有确认，且无法从源码、配置或真实工具输出验证的业务判断

## Candidate Output

如果需要沉淀知识：

1. 生成候选文件到根目录下的 `artifacts/knowledge`
2. 不直接修改正式 `knowledge`
3. 在最终回复中说明候选文件路径、建议提升目标和需要用户确认的点

## Promotion Trigger

只有当用户明确要求提升候选知识时，Agent 才能将 `artifacts/knowledge` 中的候选内容写入正式 `knowledge`。

有效触发包括：

- “提升这条候选知识”
- “将这个候选合并到 knowledge”
- “审核并写入正式 knowledge”
- “把这些候选知识转为正式知识”
- “将 `artifacts/knowledge/xxx.md` 提升为正式知识”

Agent 不得因为任务完成、测试通过、候选存在或自行判断有价值而自动提升正式 `knowledge`。

## Promotion Rule

只有用户明确要求“提升”“写入”“合并到 knowledge”时，Agent 才能把候选知识写入正式 `knowledge`。

## Candidate Lifecycle After Promotion

候选知识提升为正式 `knowledge` 后，Agent 必须处理原候选文件：

- 如果候选内容已全部提升为正式知识，删除原候选文件。
- 如果候选内容只有部分提升，且剩余内容仍有后续确认或沉淀价值，则更新原候选文件，只保留未提升内容。
- 如果候选内容只有部分提升，但剩余内容没有继续保留价值，则删除原候选文件。

Agent 不应在候选内容已处理完成后继续保留完整候选文件，避免 `artifacts/knowledge` 中出现已完成、重复或过期的候选。
