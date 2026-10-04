import { promises as fs } from 'node:fs'
import path from 'node:path'

import { app, dialog } from 'electron'

import type { VaultInfo, VaultState } from '@shared/ipc'
import { toPosix } from '@shared/notes'

import { config } from '../config'
import { scanTree } from './scan'

/**
 * 笔记库的根：选位置、切库、记住上次的选择。
 *
 * 路径约定：跨进程传输一律使用 POSIX 分隔符，仅在真正访问文件系统前转回系统分隔符。
 */

export async function selectVault(): Promise<VaultState | null> {
  const result = await dialog.showOpenDialog({
    title: '选择笔记库文件夹',
    buttonLabel: '设为笔记库',
    properties: ['openDirectory', 'createDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  return activateVault(result.filePaths[0])
}

export async function activateVault(rootPath: string): Promise<VaultState> {
  const root = path.resolve(rootPath)
  const stat = await fs.stat(root).catch(() => null)

  if (!stat || !stat.isDirectory()) {
    throw new Error(`目录不存在或不是文件夹：${rootPath}`)
  }

  config.set('vaultRoot', root)
  rememberVault(root)

  return { info: toVaultInfo(root), tree: await scanTree(root) }
}

/** 首选位置：文稿里的「Sandsea」，访达里一眼能找到 */
function preferredVaultPath(): string {
  return path.join(app.getPath('documents'), 'Sandsea')
}

/** 兜底位置：家目录根，不受 TCC 保护 */
function fallbackVaultPath(): string {
  return path.join(app.getPath('home'), 'Sandsea')
}

/**
 * 依次尝试候选位置，返回第一个**真正建得出来**的目录。
 *
 * 候选顺序：文稿（访达里好找）→ 家目录根（不受 TCC 保护）。
 *
 * 关键在于「建目录」和「返回候选」是同一件事，不再分两步：早先写成
 * 「先试探一次、再在真正创建时又 mkdir 一次」，而 macOS 对文稿的授权
 * 会出现**同一路径相邻两次调用一次成功一次被拒**的间歇行为 ——
 * 试探过了、创建时却抛 EACCES，错误就直接漏给用户了。
 */
async function resolveVaultPath(): Promise<string | null> {
  for (const candidate of [preferredVaultPath(), fallbackVaultPath()]) {
    if (await ensureDirectory(candidate)) return candidate
  }
  return null
}

/** 能建出来（或本来就是目录）就算可用 */
async function ensureDirectory(target: string): Promise<boolean> {
  const stat = await fs.stat(target).catch(() => null)
  if (stat) return stat.isDirectory()

  try {
    await fs.mkdir(target, { recursive: true })
    return true
  } catch {
    return false
  }
}

/** 默认笔记库位置（展示用）。两个候选都建不出来时仍然返回首选，让用户点了之后看到明确提示 */
export async function defaultVaultPath(): Promise<string> {
  return (await resolveVaultPath()) ?? preferredVaultPath()
}

/**
 * 在默认位置建库并切过去。
 *
 * 目录是空的就放一篇引导笔记 —— 否则首次进来左边一片空白、右边只有
 * 「从左侧选择一个文件」，很容易让人不知道下一步该做什么。
 * 目录里已经有东西时（例如重装后配置丢了）什么都不塞，直接把已有的笔记接过来。
 */
export async function activateDefaultVault(): Promise<VaultState> {
  const target = await resolveVaultPath()
  if (!target) {
    throw new Error('系统不允许创建笔记库文件夹，请改用「选择其他文件夹」指定一个可写的位置。')
  }

  const entries = await fs.readdir(target).catch(() => [])
  if (entries.length === 0) {
    await fs.writeFile(path.join(target, WELCOME_NOTE_NAME), buildWelcomeNote(target), 'utf8')
  }

  return activateVault(target)
}

const WELCOME_NOTE_NAME = '欢迎.md'

/**
 * 引导笔记的内容。
 *
 * 这里刻意把「笔记在哪」「怎么换位置」「怎么同步」都写清楚：
 * 新用户打开应用时最大的疑问就是这几件事，写在正文里比藏在菜单里强。
 */
function buildWelcomeNote(vaultRoot: string): string {
  return [
    '# 欢迎使用 Sandsea Notes',
    '',
    '这是你的第一篇笔记。可以直接改，也可以删掉。',
    '',
    '## 笔记存在哪',
    '',
    '笔记就是普通的 `.md` 文件，全部放在这个文件夹里：',
    '',
    `\`${vaultRoot}\``,
    '',
    '用访达、VS Code 或任何一个编辑器都能打开它，不锁定格式、不进数据库。',
    '想换个位置：点侧栏顶部的「更换文件夹」。',
    '',
    '## 可以马上试的几件事',
    '',
    '- 截图后按 `Cmd+V`，图片会自动存进笔记库的 `images/`，并在光标处插入引用',
    '- 选中文字再用上方的工具栏：加粗、斜体、标题、列表、待办、表格、文字颜色',
    '- 点工具栏的表格按钮会展开一个方格盘，拖到哪格就插几行几列',
    '- 用三个反引号加 `mermaid` 开头写一段代码块，可以直接渲染成流程图',
    '- 右上角切换 编辑 / 分栏 / 阅读；分栏时两边的滚动是联动的',
    '- 在编辑区选中文字后右键，可以剪切 / 复制 / 粘贴 / 全选',
    '',
    '## 保存',
    '',
    '不用管保存。停手大约 0.7 秒会自动落盘，`Cmd+S` 也可以立刻保存。',
    '',
    '## 版本历史',
    '',
    '打开这个文件夹时，本地版本历史就已经自动开好了，不用配置。',
    '',
    '- 底栏「提交到历史」把当前改动记一版',
    '- 底栏「历史」翻看每一版、逐行对比，也能把某个文件退回旧版本',
    '',
    '想让另一台设备也看到这些笔记：在底栏「设置」里填上 GitHub / Gitee 的仓库地址，',
    '底栏的按钮就会从「提交到历史」变成「同步」。',
    '',
    '## Markdown 语法',
    '',
    '底栏「关于」里有语法参考的链接。',
    '',
    '---',
    '',
    '> 这篇笔记只在第一次新建笔记库时生成，删掉之后不会再出现。'
  ].join('\n')
}

/** 读取当前笔记库状态；目录已被移动或删除时自动清理配置，避免每次启动都报错 */
export async function currentVaultState(): Promise<VaultState> {
  const root = config.get('vaultRoot')
  if (!root) return { info: null, tree: [] }

  const stat = await fs.stat(root).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    config.set('vaultRoot', null)
    return { info: null, tree: [] }
  }

  return { info: toVaultInfo(root), tree: await scanTree(root) }
}

export async function clearVault(): Promise<void> {
  config.set('vaultRoot', null)
}

export function requireVaultRoot(): string {
  const root = config.get('vaultRoot')
  if (!root) throw new Error('尚未选择笔记库')
  return root
}

/** 未选择笔记库时返回 null，供不需要强制要求的调用方使用 */
export function optionalVaultRoot(): string | null {
  return config.get('vaultRoot')
}

function toVaultInfo(root: string): VaultInfo {
  return { name: path.basename(root), rootPath: toPosix(root) }
}

function rememberVault(root: string): void {
  const recent = config.get('recentVaults').filter((item) => item !== root)
  config.set('recentVaults', [root, ...recent].slice(0, 10))
}
