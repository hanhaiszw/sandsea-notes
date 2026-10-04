# Sandsea Notes

**你的笔记，就是磁盘上的 `.md` 文件。**

Sandsea Notes 是一个本地优先的 Markdown 笔记软件。笔记存在你自己选的文件夹里，用任何编辑器都能打开，不会被锁进某个数据库。每次改动自动记进本地版本历史，随时能翻看、能退回旧版本；需要多端同步时，再把这个文件夹接上 Git 仓库就行。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#安装)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**简体中文** · [English](./README.en.md)

仓库：[Gitee](https://gitee.com/hanhaiszw/sandsea-notes) · [GitHub](https://github.com/YOUR_GITHUB_USERNAME/sandsea-notes)

> GitHub 那处仍是占位，建好仓库后把 `YOUR_GITHUB_USERNAME` 换成你的账号，`package.json` 里的对应占位也要一起改。

---

## 特性

- **笔记就是文件** —— 纯 `.md` 存在你选的文件夹里，不锁定格式、不导入数据库，随时能换软件
- **写起来顺手** —— 源码编辑 + 实时预览，停止输入自动保存；标题、列表、表格、文字颜色一键插入
- **贴图不折腾** —— 截图直接 `Cmd+V` 自动存入笔记库并生成引用，预览里拖一下就能改大小
- **三种视图** —— 编辑 / 分栏 / 阅读随时切换，支持 Mermaid 图表、任务列表、脚注；预览里能直接勾待办、改表格、增删行列
- **深浅色主题** —— 跟随系统，也可以手动切换
- **版本历史** —— 打开笔记库就自动开启，零配置。不联网也能翻看每次改动的逐行差异，把单个文件退回旧版
- **Git 同步（可选）** —— 要多设备时再接上 GitHub / Gitee 一键提交推送；本机没装 git 也能用（内置实现）
- **纯本地** —— 除你配置的 Git 远程外不发起任何网络请求，无遥测

## 界面

**源码与预览并排，滚动联动** —— 左边写，右边即时看到结果；工具栏覆盖标题、列表、待办、表格、文字颜色。

![分栏编辑](./docs/screenshots/01-split-editor.png)

**Mermaid 图表** —— 代码块的语言写上 `mermaid` 就会渲染成图。

![Mermaid 图表](./docs/screenshots/02-preview-mermaid.png)

**预览里能直接改** —— 勾选待办、点单元格改表格、增删行列，改动都会写回源码。

| 表格与待办 | 图片与文字颜色 |
| --- | --- |
| ![表格与待办](./docs/screenshots/03-preview-tables-tasks.png) | ![图片与文字颜色](./docs/screenshots/04-preview-images-colors.png) |

**版本历史** —— 打开笔记库自动开启；提交前一屏看清这次改了什么，历史里三栏翻看，也能把单个文件恢复成旧版本。

| 提交与差异 | 文件历史 |
| --- | --- |
| ![提交与差异](./docs/screenshots/05-commit-diff.png) | ![文件历史](./docs/screenshots/06-history.png) |

## 安装

### 普通用户

**暂时没有可直接下载的安装包**，请按下面「从源码运行」自行打包。原因有两个：GitHub / Gitee 的 Releases 还没有附件；打出来的 `.dmg` 约 141 MB，超过 Gitee 发行版单个附件 100 MB 的上限。

### 从源码运行

需要 **Node.js 20.19+ 或 22.12+**。目前只支持 macOS（Apple Silicon）。

```bash
git clone https://gitee.com/hanhaiszw/sandsea-notes.git
cd sandsea-notes
npm install
npm run dev
```

国内网络建议给 Electron 二进制走镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

打成可以双击的 `.app`，或者直接生成 `.dmg`：

```bash
npm run pack   # 产物：release/mac-arm64/Sandsea Notes.app
npm run dmg    # 产物：release/Sandsea Notes-0.1.0-arm64.dmg
```

> 自行打出来的包没有代码签名：本机双击可以正常打开；一旦经浏览器或网盘传给他人，对方首次打开会被 Gatekeeper 拦下，需要在「系统设置 → 隐私与安全性」里放行。

## 上手 3 步

1. **选笔记库** —— 首次打开点「选择文件夹」，选一个文件夹（空的、或者已经有笔记的都行）
2. **新建笔记** —— 左侧文件树里右键 →「新建笔记」，然后直接写
3. **不用管保存** —— 停止输入约 0.7 秒自动落盘，`Cmd+S` 可以立刻保存

## 常用快捷键

| 快捷键 | 作用 |
|---|---|
| `Cmd+S` / `Ctrl+S` | 立即保存 |
| `Cmd+B` / `Ctrl+B` | 加粗选中内容 |
| `Cmd+I` / `Ctrl+I` | 斜体选中内容 |
| `Tab` / `Shift+Tab` | 缩进 / 取消缩进 |

## 文档

| 文档 | 内容 |
|---|---|
| [使用手册](./docs/manual.zh-CN.md) | 完整功能说明：工具栏、图片、版本历史与同步、数据与安全、常见问题 |
| [技术方案](./技术方案.md) | 架构分层、技术选型、安全基线、设计决策（中文） |

## 参与贡献

欢迎提 Issue 和 PR。提交前请确认 **`npm run typecheck` 通过** —— 主进程与渲染进程都做了严格类型检查，类型错误会挡住合并。

改动代码前请先了解项目的分层与安全基线，见[使用手册 · 参与贡献](./docs/manual.zh-CN.md#11-参与贡献)。

## 许可证

[MIT](./LICENSE) © 2026 Sandsea Notes contributors

你可以自由使用、修改、分发本项目，包括商业用途，只需保留版权与许可声明。
