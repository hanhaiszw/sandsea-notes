# Sandsea Notes

**你的笔记，就是磁盘上的 `.md` 文件。**

Sandsea Notes 是一个本地优先的 Markdown 笔记软件。笔记存在你自己选的文件夹里，用任何编辑器都能打开，不会被锁进某个数据库。每次改动自动记进本地版本历史，随时能翻看、能退回旧版本；需要多端同步时，再把这个文件夹接上 Git 仓库就行。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#安装)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**简体中文** · [English](./README.en.md)

仓库：[GitHub](https://github.com/YOUR_GITHUB_USERNAME/sandsea-notes) · [Gitee](https://gitee.com/YOUR_GITEE_USERNAME/sandsea-notes)

> 建好仓库后把上面两处的 `YOUR_*_USERNAME` 换成你的账号，`package.json` 里的占位也要一起改。

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

## 安装

### 普通用户

**目前还没有提供预编译包**（GitHub / Gitee 的 Releases 是空的），请先按下面「从源码运行」操作。

### 从源码运行

需要 **Node.js 20.19+ 或 22.12+**。

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/sandsea-notes.git
cd sandsea-notes
npm install
npm run dev
```

国内网络建议给 Electron 二进制走镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

想打包成可以双击的 `.app`：

```bash
npm run pack   # 产物在 release/mac-arm64/Sandsea Notes.app
```

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
