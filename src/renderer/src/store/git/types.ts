import type { StateCreator } from 'zustand'

import type {
  CommitFile,
  CommitSummary,
  FileDiff,
  GitConfig,
  GitConnectInput,
  GitSetupInput,
  GitStatus,
  LineStat
} from '@shared/git'

/** 提示条的两种语气：错误要显眼，成功只是告知 */
export interface Notice {
  tone: 'error' | 'info'
  text: string
}

/** 底栏的同步状态与「提交并推送 / 拉取」 */
export interface StatusSlice {
  status: GitStatus | null
  /** 有 Git 操作进行中；底栏按钮据此置灰 */
  busy: boolean
  /** 状态栏里的提示条 */
  notice: Notice | null
  /** 检测到远端领先：弹窗内给出说明，状态栏保留「拉取」入口 */
  behindDetected: boolean
  refresh: () => Promise<void>
  reset: () => void
  notifyFileChange: () => void
  pull: () => Promise<void>
  clearNotice: () => void
}

/** 设置弹窗：远程地址与令牌、本地历史初始化、从远程克隆 */
export interface SettingsSlice {
  config: GitConfig | null
  settingsOpen: boolean
  openSettings: () => Promise<void>
  closeSettings: () => void
  saveSettings: (input: GitSetupInput) => Promise<boolean>
  clearCredential: () => Promise<void>
  cloneRepo: (input: GitConnectInput) => Promise<boolean>
  /** 只初始化成本地仓库（不接远程） */
  initLocal: () => Promise<boolean>
}

/** 提交弹窗：待提交清单、提交信息，以及右栏展开的差异 */
export interface SyncDialogSlice {
  syncDialogOpen: boolean
  /** 同步弹窗内的提示：弹窗遮住了状态栏，错误必须显示在弹窗里 */
  dialogError: string | null
  commitMessage: string
  /** 当前在右栏展开的那个文件的差异；null 表示还没选中任何文件 */
  workDiff: FileDiff | null
  /** 待提交文件的行级统计，键是 POSIX 相对路径；列表上直接显示 +N/−M */
  workStats: Record<string, LineStat>
  openSyncDialog: () => void
  closeSyncDialog: () => void
  setCommitMessage: (value: string) => void
  confirmSync: () => Promise<void>
  confirmCommit: () => Promise<void>
  openWorkDiff: (filePath: string) => Promise<void>
  loadWorkStats: () => Promise<void>
}

/** 历史面板：提交记录 → 改动文件 → 单文件差异 */
export interface HistorySlice {
  historyOpen: boolean
  commits: CommitSummary[]
  /** 当前选中的提交；为 null 表示刚打开、还没选 */
  selectedCommit: CommitSummary | null
  /** 选中提交里改动的文件 */
  files: CommitFile[]
  /** 当前展开的文件差异；为 null 表示还在看文件列表 */
  diff: FileDiff | null
  historyBusy: boolean
  /** 历史面板内的提示：弹窗遮住了状态栏，错误得显示在弹窗里 */
  historyError: string | null
  openHistory: () => Promise<void>
  closeHistory: () => void
  selectCommit: (commit: CommitSummary) => Promise<void>
  openDiff: (filePath: string) => Promise<void>
  restoreFile: (filePath: string) => Promise<void>
}

export type GitStore = StatusSlice & SettingsSlice & SyncDialogSlice & HistorySlice

/**
 * slice 构造器类型。
 *
 * 四个 slice 共用同一份 set / get，因此任一 slice 里都能调用别的 slice 的动作
 * （例如保存设置后调 status 里的 refresh）—— 拆文件不改变状态本身是一份。
 */
export type GitSliceCreator<T> = StateCreator<GitStore, [], [], T>
