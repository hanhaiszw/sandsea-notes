/**
 * Git 同步相关契约（方案 §5.3）。
 *
 * 本文件同时被主进程与渲染进程引用，不得引入 Node 或 DOM 专有 API。
 */

/** 后端实现：isomorphic-git 零依赖；系统 git 行为与命令行一致且支持 SSH */
export type GitBackend = 'isomorphic' | 'system'

export interface GitAuthor {
  name: string
  email: string
}

export interface GitConfig {
  backend: GitBackend
  /** 远程仓库地址（HTTPS），空串表示尚未配置 */
  remoteUrl: string
  branch: string
  /** HTTPS 认证用的账号名（Gitee 必填；GitHub 可填任意非空值） */
  username: string
  author: GitAuthor
}

export type ChangeKind = 'added' | 'modified' | 'deleted'

export interface ChangedFile {
  /** 相对仓库根的 POSIX 路径 */
  path: string
  kind: ChangeKind
}

/** 仓库就绪状态：未初始化 / 已初始化但无远程 / 可同步 */
export type GitRepoState = 'no-repo' | 'no-remote' | 'ready'

export interface GitStatus {
  state: GitRepoState
  /** 当前分支，未初始化时为 null */
  branch: string | null
  remoteUrl: string | null
  changed: ChangedFile[]
  /** 是否已保存凭证 */
  hasCredential: boolean
  /** 远程是 HTTP(S) 时才需要访问令牌；SSH 与本地路径远程不需要 */
  requiresCredential: boolean
  /** 提供给提交弹窗的默认提交信息 */
  suggestedMessage: string
}

export type SyncOutcome = 'up-to-date' | 'pushed' | 'behind'

export interface GitSyncResult {
  outcome: SyncOutcome
  /** 本次是否产生了新提交 */
  committed: boolean
  commitOid: string | null
  changedCount: number
}

export type PullOutcome = 'up-to-date' | 'pulled'

export interface GitPullResult {
  outcome: PullOutcome
}

export type CommitOutcome = 'nothing-to-commit' | 'committed'

/**
 * 仅提交到本地（不推送）的结果。
 * 这是远端领先时的安全出口：先把改动存入版本历史，避免工作区一直脏着
 * 导致连拉取都做不了。
 */
export interface GitCommitResult {
  outcome: CommitOutcome
  commitOid: string | null
  changedCount: number
}

export interface GitSetupInput {
  backend?: GitBackend
  remoteUrl?: string
  branch?: string
  username?: string
  authorName?: string
  authorEmail?: string
  /** 留空表示不修改已保存的凭证 */
  token?: string
}

export interface GitSetupResult {
  config: GitConfig
  /**
   * 凭证是否成功落盘。
   * 系统未提供安全存储（safeStorage 不可用）时为 false，此时凭证仅本次会话有效。
   */
  credentialPersisted: boolean
}

/** 把已有远程仓库克隆到本地时使用 */
export interface GitConnectInput extends GitSetupInput {
  /** 克隆目标目录；不传则由主进程弹出目录选择对话框 */
  targetDir?: string
}

/**
 * 提交信息的默认模板：时间戳，形如 `2026-10-02 22:30  `。
 *
 * 末尾两个空格是刻意留的 —— 输入框聚焦后光标落在这里，接着往下写时手边有余量。
 *
 * 刻意不带「N 个文件变更」这类附注：改了多少在提交弹窗和历史的文件列表里
 * 一眼就能看到，写进提交信息只是重复；提交前也可以自己改成别的。
 */
export function buildCommitMessage(at: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  return `${stamp}  `
}

/* ── 历史（只读 + 单文件恢复） ───────────────────────── */

/** 历史列表里的一次提交 */
export interface CommitSummary {
  oid: string
  /** 短 hash，列表里展示用 */
  shortOid: string
  message: string
  author: string
  /** 提交时间（Unix 毫秒） */
  timestamp: number
}

/**
 * 一个文件的行级增删统计，列表里直接显示 +N/−M，省得逐个点开才知道改了多少。
 * 二进制或内容过大时不做对比（skipped），此时两个计数都是 0。
 */
export interface LineStat {
  added: number
  removed: number
  skipped: boolean
}

/** 某次提交相对其父提交改动的一个文件 */
export interface CommitFile extends LineStat {
  path: string
  kind: ChangeKind
}

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/**
 * 一个文件在两个版本之间的差异。
 *
 * 二进制或超过体积上限时不做行级对比（skipped = true），
 * 只把两个版本的大小报给界面 —— 硬算出来的「差异」只会是一堆乱码。
 */
export interface FileDiff {
  path: string
  lines: DiffLine[]
  added: number
  removed: number
  skipped: boolean
}

/**
 * 「不做行级对比」的行数占位。
 *
 * 二进制内容与体积超限都走它：两个计数固定为 0 是 skipped 语义的一部分，
 * 散在各处手写容易漏掉其中一个。
 */
export const SKIPPED_LINE_STAT: LineStat = { added: 0, removed: 0, skipped: true }

/** 整个文件不做行级对比时的差异对象 */
export function skippedDiff(path: string): FileDiff {
  return { path, lines: [], ...SKIPPED_LINE_STAT }
}

/** 历史列表一次取多少条；再多也不适合塞进一个弹窗 */
export const HISTORY_PAGE_SIZE = 50

/** 默认 .gitignore：只排除系统与依赖噪音，不排除任何用户笔记 */
export const DEFAULT_GITIGNORE = ['.DS_Store', 'Thumbs.db', 'node_modules/', ''].join('\n')
