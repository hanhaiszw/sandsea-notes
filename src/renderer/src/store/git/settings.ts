import { useVaultStore } from '../vaultStore'
import type { GitSliceCreator, SettingsSlice } from './types'

export const createSettingsSlice: GitSliceCreator<SettingsSlice> = (set, get) => ({
  config: null,
  settingsOpen: false,

  openSettings: async () => {
    const result = await window.notes.git.config()
    if (!result.ok) {
      set({ notice: { tone: 'error', text: result.error } })
      return
    }
    set({ config: result.data, settingsOpen: true, notice: null })
    // 顺带刷新一次仓库状态：弹窗里「首次接入」那一块按它决定显不显示，
    // 状态过期会让用户填完地址、点了保存之后找不到初始化入口
    await get().refresh()
  },

  closeSettings: () => set({ settingsOpen: false }),

  saveSettings: async (input) => {
    set({ busy: true, notice: null })
    const result = await window.notes.git.setup(input)
    if (!result.ok) {
      set({ busy: false, notice: { tone: 'error', text: result.error } })
      return false
    }

    set({ busy: false, config: result.data.config, settingsOpen: false })
    if (!result.data.credentialPersisted) {
      set({
        notice: {
          tone: 'error',
          text: '当前系统未提供安全存储，令牌仅在本次运行期间有效'
        }
      })
    }
    await get().refresh()
    return true
  },

  clearCredential: async () => {
    set({ busy: true, notice: null })
    const result = await window.notes.git.clearCredential()
    if (!result.ok) {
      set({ busy: false, notice: { tone: 'error', text: result.error } })
      return
    }
    // 关掉设置弹窗，让状态栏的提示可见
    set({
      busy: false,
      settingsOpen: false,
      notice: { tone: 'info', text: '已清除保存的访问令牌' }
    })
    await get().refresh()
  },

  cloneRepo: async (input) => {
    set({ busy: true, notice: null })
    const result = await window.notes.git.clone(input)
    if (!result.ok) {
      set({ busy: false, notice: { tone: 'error', text: result.error } })
      return false
    }

    set({
      busy: false,
      status: result.data,
      settingsOpen: false,
      notice: { tone: 'info', text: '克隆完成，已切换到新的笔记库' }
    })
    // 克隆会把笔记库切到新目录，需要重新加载文件树并重绑文件监听
    await useVaultStore.getState().loadCurrentVault()
    return true
  },

  initLocal: async () => {
    set({ busy: true, notice: null })
    const result = await window.notes.git.initLocal()
    if (!result.ok) {
      set({ busy: false, notice: { tone: 'error', text: result.error } })
      return false
    }

    set({
      busy: false,
      status: result.data,
      settingsOpen: false,
      // 提交信息跟着新的状态走：初始化后文件都变成「新增」，时间戳也要刷新
      commitMessage: result.data.suggestedMessage,
      notice: {
        tone: 'info',
        text: '已为这个笔记库开启本地版本历史，底栏「历史」可以翻看每次改动'
      }
    })
    return true
  }
})
