import { useVaultStore } from '../vaultStore'
import type { GitSliceCreator, HistorySlice } from './types'

export const createHistorySlice: GitSliceCreator<HistorySlice> = (set, get) => ({
  historyOpen: false,
  commits: [],
  selectedCommit: null,
  files: [],
  diff: null,
  historyBusy: false,
  historyError: null,

  openHistory: async () => {
    set({
      historyOpen: true,
      historyBusy: true,
      historyError: null,
      commits: [],
      selectedCommit: null,
      files: [],
      diff: null
    })

    const result = await window.notes.git.history()
    if (!result.ok) {
      set({ historyBusy: false, historyError: result.error })
      return
    }
    set({ historyBusy: false, commits: result.data })

    // 顺手选中最新一条：打开面板即可看到最近一次改了哪些文件，
    // 不必先自己点一下才知道右边能看什么
    const latest = result.data[0]
    if (latest) await get().selectCommit(latest)
  },

  closeHistory: () =>
    set({ historyOpen: false, selectedCommit: null, files: [], diff: null, historyError: null }),

  selectCommit: async (commit) => {
    set({ selectedCommit: commit, files: [], diff: null, historyBusy: true, historyError: null })

    const result = await window.notes.git.commitFiles(commit.oid)
    // 请求在途时用户可能已经改选了别的提交，过期的结果一律丢弃 ——
    // 否则会拿 A 的文件列表配上 B 的 oid 去取差异
    if (get().selectedCommit?.oid !== commit.oid) return

    if (!result.ok) {
      set({ historyBusy: false, historyError: result.error })
      return
    }
    set({ historyBusy: false, files: result.data })

    // 顺手选中第一个文件：打开面板就能直接看到差异，不必先自己点一下
    const first = result.data[0]
    if (first) await get().openDiff(first.path)
  },

  openDiff: async (filePath) => {
    const commit = get().selectedCommit
    if (!commit) return

    const result = await window.notes.git.fileDiff(commit.oid, filePath)
    if (get().selectedCommit?.oid !== commit.oid) return

    if (!result.ok) {
      set({ historyError: result.error })
      return
    }
    set({ historyError: null, diff: result.data })
  },

  restoreFile: async (filePath) => {
    const commit = get().selectedCommit
    if (!commit) return

    // 恢复会改写磁盘上的文件，文件监听随后会把编辑器里那份替换掉 ——
    // 所以正在编辑且未保存时先拦下来，否则用户的改动会无声消失
    const vault = useVaultStore.getState()
    if (vault.activePath === filePath && vault.content !== vault.savedContent) {
      set({
        historyError: '这个文件在编辑器里还有未保存的改动。请先保存或撤销，再恢复历史版本。'
      })
      return
    }

    set({ historyBusy: true, historyError: null })
    const result = await window.notes.git.restoreFile(commit.oid, filePath)
    if (!result.ok) {
      set({ historyBusy: false, historyError: result.error })
      return
    }

    set({
      historyBusy: false,
      notice: { tone: 'info', text: `已把「${filePath}」恢复成该提交时的内容，尚未提交` }
    })

    // 文件已经换了内容：让文件树与编辑器跟着更新，同步状态也重算
    await vault.refreshTree()
    if (vault.activePath) await useVaultStore.getState().openFile(vault.activePath)
    await get().refresh()
  }
})
