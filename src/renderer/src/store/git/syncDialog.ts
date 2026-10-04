import type { GitSliceCreator, SyncDialogSlice } from './types'

export const createSyncDialogSlice: GitSliceCreator<SyncDialogSlice> = (set, get) => ({
  syncDialogOpen: false,
  dialogError: null,
  commitMessage: '',
  workDiff: null,
  workStats: {},

  openSyncDialog: () => {
    // 按当前状态重算一次提交信息：默认模板是时间戳，状态刷新有防抖，
    // 沿用上一次算出来的时间会跟「现在」对不上
    set({
      syncDialogOpen: true,
      notice: null,
      dialogError: null,
      workDiff: null,
      workStats: {},
      commitMessage: get().status?.suggestedMessage ?? ''
    })

    void get().loadWorkStats()

    // 顺手选中第一个文件：和历史面板一样，打开就能直接看到内容
    const first = get().status?.changed[0]
    if (first) void get().openWorkDiff(first.path)
  },

  closeSyncDialog: () => set({ syncDialogOpen: false, dialogError: null, workDiff: null }),

  setCommitMessage: (value) => set({ commitMessage: value }),

  /**
   * 拉一次每个待提交文件的行数。
   * 失败就静默降级成不显示行数 —— 这只是锦上添花的信息，不该因此打断提交。
   */
  loadWorkStats: async () => {
    const result = await window.notes.git.workingStats()
    if (result.ok) set({ workStats: result.data })
  },

  openWorkDiff: async (filePath) => {
    const result = await window.notes.git.workingDiff(filePath)
    // 弹窗可能在请求在途时被关掉，过期的结果不该再写回去
    if (!get().syncDialogOpen) return

    if (!result.ok) {
      set({ dialogError: result.error })
      return
    }
    set({ dialogError: null, workDiff: result.data })
  },

  confirmSync: async () => {
    set({ busy: true, notice: null, dialogError: null })
    const result = await window.notes.git.sync(get().commitMessage)
    if (!result.ok) {
      set({ busy: false, dialogError: result.error })
      return
    }

    const { outcome, changedCount } = result.data

    if (outcome === 'behind') {
      // 保持弹窗打开：用户就在这里，出口也应该在这里给
      set({
        busy: false,
        behindDetected: true,
        notice: { tone: 'error', text: '远端有本地没有的提交，无法直接推送' }
      })
    } else if (outcome === 'pushed') {
      set({
        busy: false,
        syncDialogOpen: false,
        workDiff: null,
        behindDetected: false,
        notice: { tone: 'info', text: `已推送 ${changedCount} 个文件的变更` }
      })
    } else {
      set({
        busy: false,
        syncDialogOpen: false,
        workDiff: null,
        notice: { tone: 'info', text: '没有需要同步的改动' }
      })
    }

    await get().refresh()
  },

  confirmCommit: async () => {
    set({ busy: true, notice: null, dialogError: null })
    const result = await window.notes.git.commit(get().commitMessage)
    if (!result.ok) {
      set({ busy: false, dialogError: result.error })
      return
    }

    const { outcome, changedCount } = result.data

    set({
      busy: false,
      syncDialogOpen: false,
      workDiff: null,
      notice:
        outcome === 'committed'
          ? { tone: 'info', text: `已提交 ${changedCount} 个文件的改动到本地，尚未推送` }
          : { tone: 'info', text: '没有需要提交的改动' }
    })

    await get().refresh()
  }
})
