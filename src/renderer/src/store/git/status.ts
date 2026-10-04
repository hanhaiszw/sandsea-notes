import { useVaultStore } from '../vaultStore'
import type { GitSliceCreator, StatusSlice } from './types'

/** 文件变动后刷新同步状态需要重新扫描工作区，比刷文件树更重，防抖时间放长一些 */
const STATUS_REFRESH_DEBOUNCE_MS = 900

let statusTimer: ReturnType<typeof setTimeout> | null = null

export const createStatusSlice: GitSliceCreator<StatusSlice> = (set, get) => ({
  status: null,
  busy: false,
  notice: null,
  behindDetected: false,

  refresh: async () => {
    const result = await window.notes.git.status()
    if (!result.ok) {
      set({ status: null, notice: { tone: 'error', text: result.error } })
      return
    }

    // 提交弹窗开着时不回写提交信息：任何一次落盘都会触发这次刷新，
    // 而用户可能正在那个输入框里写东西，回写等于把他写的字冲掉
    set(
      get().syncDialogOpen
        ? { status: result.data }
        : { status: result.data, commitMessage: result.data.suggestedMessage }
    )
  },

  reset: () => set({ status: null, behindDetected: false, notice: null }),

  notifyFileChange: () => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => {
      statusTimer = null
      if (useVaultStore.getState().info) void get().refresh()
    }, STATUS_REFRESH_DEBOUNCE_MS)
  },

  pull: async () => {
    set({ busy: true, notice: null })
    const result = await window.notes.git.pull()
    if (!result.ok) {
      set({ busy: false, notice: { tone: 'error', text: result.error } })
      return
    }

    set({
      busy: false,
      behindDetected: false,
      notice: {
        tone: 'info',
        text: result.data.outcome === 'pulled' ? '已拉取远端更新' : '已经是最新'
      }
    })

    // 拉取会改写工作区文件，刷新文件树与当前预览
    await useVaultStore.getState().refreshTree()
    const active = useVaultStore.getState().activePath
    if (active) await useVaultStore.getState().openFile(active)
    await get().refresh()
  },

  clearNotice: () => set({ notice: null })
})
