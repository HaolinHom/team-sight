# 甘特图渲染选型与共享布局

> 适用版本：MCP 0.3.0。2026-11-06 按当前源码复核；第三方选型背景来自 2026-10-10 对 Frappe Gantt 1.2.2 的检查，不代表其他版本的能力。

## 选型结论

成员分组甘特图采用项目内自研 SVG 渲染与 core 共享布局。原选型检查发现，Frappe Gantt 1.2.2 按任务下标计算等高行，不提供所需左侧任务名列；插入成员标题、处理不同类型行及对齐固定名称列需要额外改造。此背景只解释选型，不作为当前第三方库源码入口。

## 当前布局契约

- `packages/core/src/layout.ts` 的 `computeLayout` 统一产出行 y、高度、条形 x／宽度与画布尺寸；交互图层和导出均消费共享结果。
- 坐标为 `x = dateDiff(rangeStart, visibleStart) × dayColumnWidth`，宽度含首尾两天；显示裁剪不改原日期。日期差使用 UTC 零点，分析中的“今天”由配置时区和 analysisDate 确定。
- Apps 名称列与时间轴处于同一滚动容器，名称列使用 `position:sticky; left:0`，日期表头使用 `position:sticky; top:0`；不再采用旧 Tauri 的 translateY 同步滚动说明。
- 成员优先遵循传入的 memberOrder；未指定成员按中文姓名和稳定键排序，未分配成员在最后。MCP UI 使用分析 members 顺序，导出使用 context.memberIds 顺序。
- 组内按展示开始日、截止日、项目及 ID 稳定排序。每成员／工作项只占一行，多条真实／虚拟区间由该行承载；展示资格和区间生成先于布局，详见[交互与虚拟排期](mcp-gantt-interaction-notes.md)。

## 重新选型的检查项

重新评估第三方库时，先验证成员标题行、不同类型行的高度、固定名称列、只读排期及多区间条形能力。当前实现入口为[共享布局](../packages/core/src/layout.ts)、[展示模型](../apps/mcp-ui/src/gantt-model.ts)、[图层](../apps/mcp-ui/src/GanttLayers.vue)与[导出](../apps/server/src/outputs.ts)。
