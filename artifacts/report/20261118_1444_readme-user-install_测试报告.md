# README 用户安装指引测试报告

## Summary

对照用户要求检查 README 的安装顺序、可复制指令、版本信息与相关链接，并匿名核对公开分发状态。

## Results

- 安装与连接位于产品简介之后；Agent 自动安装列为推荐方式，发行包列为备选。
- 自带运行时与精简版分别提供完整 Agent 指令，注明适用平台、精简版的 Node.js 要求与安装后的连接步骤。
- README 已移除固定 TeamSight 版本、带版本号的包名和历史版本措辞。手动运行、认证配置及源码开发链接指向现有文档章节。
- `git diff --check -- README.md` 通过。

## Issues

- 两个 Pages 安装入口与 GitHub 最新公开 Release API 均返回 HTTP 404，公开发行列表为空。README 已在命令前标明暂勿执行，没有把发行包备选写成已公开上架。

## Not Tested

- 本次仅修改文档，未执行安装脚本、修改 Codex 配置或重新进行实机验收。

## Artifacts

- `README.md`
- `apps/server/README.md`
