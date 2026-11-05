# packages dist Git 跟踪重新调整测试报告

## Summary

用户要求重新处理。操作前 .gitignore 已包含 /packages/*/dist，但两个 dist 目录的 46 个文件仍被 Git 跟踪。本次重新执行 git rm -r --cached，保留本地文件及现有忽略规则。

## Results

- git ls-files 确认两个 dist 目录已无跟踪文件；46 项索引删除已暂存。
- git check-ignore 确认现有 46 个本地产物文件全部被忽略。
- 操作前后全部本地产物的文件路径及 SHA-256 一致。
- 除目标 dist 目录外，其他暂存修改的二进制 diff 完全一致。
- .gitignore 内容保持原样。

## Issues

未发现问题；未创建 Git 提交。

## Not Tested

未运行构建或业务测试；仅调整 Git 索引，未修改业务源码及编译产物。

## Artifacts

- .gitignore
- packages/core/dist
- packages/tapd/dist
- git ls-files、git check-ignore、git diff --cached --binary。
