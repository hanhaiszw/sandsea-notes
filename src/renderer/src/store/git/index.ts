import { create } from 'zustand'

import { createHistorySlice } from './history'
import { createSettingsSlice } from './settings'
import { createStatusSlice } from './status'
import { createSyncDialogSlice } from './syncDialog'
import type { GitStore } from './types'

/**
 * Git 相关的界面状态。
 *
 * 按四块职责分成 slice：底栏状态、设置弹窗、提交弹窗、历史面板。
 * 它们共用同一份 set / get，所以 busy、notice 这些跨块的状态仍然只有一份 ——
 * 拆开只是为了让单个文件不至于四百多行，状态结构没有变。
 */
export const useGitStore = create<GitStore>()((...args) => ({
  ...createStatusSlice(...args),
  ...createSettingsSlice(...args),
  ...createSyncDialogSlice(...args),
  ...createHistorySlice(...args)
}))
