# Archify Reader

[English](README.md) | 简体中文

从 Archify 图中的节点进入业务说明，就地对照固定版本的源码，并沿节点引用继续阅读。

这是非官方配套 skill。Archify 负责生成图，Reader 在其 HTML 上增加阅读层：整节点悬停注释、Markdown 详情、源码与白话并排、节点引用及返回。源码在构建时嵌入，阅读时不需要网络或源码仓库。

## 先体验

双击 `examples/campus-events/diagram.reader.html`。选中节点后点击工具栏“详情”；正文中的链接可以切换节点，并返回原阅读位置。
示例是专门为公开分享编写的虚构校园活动报名系统。图和示例正文目前为英文，Reader 操作按钮为中文。业务源码尚未运行，不作为生产系统范例。

## 用到自己的项目

需要 Node.js 22 或更新版本、本地 Git、官方 Archify，以及待分析的源码仓库。

把完整 `skill/archify-reader` 目录交给智能体读取，或复制到你所用工具的 skill 目录。不能只复制 SKILL.md。官方 Archify 需单独准备，本包不自动安装或升级它。

可直接对智能体说：

> 请使用官方 Archify 和 archify-reader，分析这个项目的指定业务链路。先读取 reader 的 SKILL.md，核对固定 commit 的源码，生成图和可连续阅读的业务详情，并为已有实现提供源码证据。保留原生图，输出增强 HTML；遇到事实不清楚就标明，不修改工具代码来绕过检查。

若已有增强图：

> 请在现有 MD 和 reader.json 上补充证据，保留原图、节点 ID、引用与正确叙述，再生成同名增强版。发现原文错误时列出依据与修改原因。

普通构建命令：

```text
node skill/archify-reader/scripts/build.mjs <你的reader.json路径>
```

证据与引用的完整格式见 `skill/archify-reader/references/`。源码来自 commit，未提交改动不会进入证据。

## 重建本包示例

在本包根目录运行（路径中有空格时加引号）：

```text
node scripts/build-demo.mjs "<官方Archify目录>/archify/bin/archify.mjs"
```

官方 skill ZIP 的目录结构可能不同，请使用实际 `bin/archify.mjs` 路径。脚本输出 JSON，其中 `html` 为成品，`manifest` 可用于浏览器验证。
若只重建阅读层，可运行 `node scripts/build-demo.mjs`，复用随包附带的原生图。

脚本只在系统临时目录创建一个虚构源码 Git 仓库及构建文件；不修改本包或你的项目仓库。不必运行 Python 服务或安装 FastAPI。临时源码 commit 会随源码/换行变化；每次构建使用实际生成的完整哈希。

## 测试与边界

```text
node --test skill/archify-reader/test/build.test.mjs skill/archify-reader/test/evidence.test.mjs skill/archify-reader/test/references.test.mjs
node scripts/check-browser.cjs <上一步输出的manifest路径>
```

浏览器测试需要 Playwright 和 Chrome；Playwright 可由 NODE_PATH 指定现有安装。本包运行时无需安装 npm 依赖。
兼容结果见 `COMPATIBILITY.md`。目前公开验证范围是 Workflow 样例，不能据此声称所有图类型与所有版本均可用。

构建检查证明源码来源与映射格式合法，不证明业务解释正确、段落覆盖完整或代码运行正确。Reader 使用 Archify 的 DOM 标记适配，尚非官方稳定扩展接口。
增强 HTML 内嵌实际源码，分享自己的产物前需确认其中的代码可以公开。

## 署名与发布

维护者署名：**pioneer**。项目采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商用；分发时需保留版权及许可声明。第三方组件保留各自声明，见 [第三方来源](THIRD-PARTY-NOTICES.md)。

项目由 pioneer 提出需求、裁决业务阅读体验，并在 AI 协助下实现、测试和整理文档。GitHub 维护者：[pioneer666-user](https://github.com/pioneer666-user)。欢迎通过本仓库 Issues 提交问题、使用反馈和可复现示例。
