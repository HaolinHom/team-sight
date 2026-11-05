# packages dist Git 跟踪调整测试报告

## Summary

将 packages/core/dist 与 packages/tapd/dist 从 Git 索引移除，保留本地文件，并在 .gitignore 添加 /packages/*/dist。

## Results

- Git 索引：原有 46 个产物文件已全部移出跟踪。
- 忽略规则：两个目录现有的 46 个本地文件全部通过 git check-ignore 校验。
- 本地文件：操作前后全部文件路径及 SHA-256 一致。
- 其他暂存修改：操作前后 git diff --cached --binary 一致（排除本次两个 dist 目录）。

## Issues

未发现问题。

## Not Tested

未运行构建或业务测试；本次仅调整 Git 跟踪与忽略规则，未修改业务源码或本地产物。

## Artifacts

- .gitignore
- packages/core/dist
- packages/tapd/dist
- 检查命令：git ls-files、git check-ignore、git diff --cached --binary。
