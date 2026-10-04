import { create } from 'zustand'

import type { VaultInfo, VaultState, WatchPayload } from '@shared/ipc'
import { isImageFile, type EntryKind, type FileNode } from '@shared/notes'

/**
 * 结构变化后的整树刷新延迟。
 * 「change」事件（每次保存都会产生）不触发刷新，只有新增/删除才重扫，
 * 因此这个防抖只是为了合并连续的文件操作，不会影响编辑期间的输入流畅度。
 */
const TREE_REFRESH_DEBOUNCE_MS = 200

/** 停止输入多久后自动落盘；Mod+S 会立即写入 */
const AUTOSAVE_DEBOUNCE_MS = 700

let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface VaultStore {
  /** 首次读取配置是否完成，用于避免启动时闪现空状态 */
  ready: boolean
  info: VaultInfo | null
  tree: FileNode[]
  activePath: string | null
  /** 编辑器中的当前文本 */
  content: string | null
  /** 上次落盘的内容，用于判断是否存在未保存改动 */
  savedContent: string
  /** 上次读写的文件时间戳，写回时用于检测外部改动 */
  mtimeMs: number | null
  saveState: SaveState
  notice: string | null
  /** 首次使用时的默认笔记库位置，欢迎页展示用；还没读到时为 null */
  defaultVaultPath: string | null
  setNotice: (message: string | null) => void
  loadCurrentVault: () => Promise<void>
  loadDefaultVaultPath: () => Promise<void>
  chooseVault: () => Promise<void>
  /** 用默认位置建库并切过去（目录不存在会创建，新建的空目录里会放一篇引导笔记） */
  useDefaultVault: () => Promise<void>
  refreshTree: () => Promise<void>
  openFile: (relPath: string) => Promise<void>
  setContent: (next: string) => void
  save: () => Promise<void>
  revealVault: () => Promise<void>
  /** 新建弹窗的目标；null 表示弹窗关闭 */
  createDialog: { kind: EntryKind; parentPath: string } | null
  createBusy: boolean
  createError: string | null
  /** 在指定目录下新建；parentPath 为空串表示笔记库根目录 */
  openCreateDialog: (kind: EntryKind, parentPath: string) => void
  closeCreateDialog: () => void
  submitCreate: (name: string) => Promise<void>
  handleWatchEvent: (payload: WatchPayload) => void
}

const EMPTY_EDITOR = { content: null, savedContent: '', mtimeMs: null, saveState: 'idle' as SaveState }

export const useVaultStore = create<VaultStore>((set, get) => {
  const applyVaultState = (state: VaultState): void => {
    set({ info: state.info, tree: state.tree })
    if (!state.info) set({ activePath: null, ...EMPTY_EDITOR })
  }

  /** 把编辑器内容写回磁盘；没有改动时直接返回 */
  const persist = async (): Promise<void> => {
    const { activePath, content, savedContent, mtimeMs } = get()
    if (!activePath || content === null || content === savedContent) return

    set({ saveState: 'saving' })
    const result = await window.notes.file.write(activePath, content, mtimeMs)

    if (!result.ok) {
      set({ saveState: 'error', notice: result.error })
      return
    }

    // 写入期间用户可能又改了内容：此时不能当成「已保存」
    set({
      mtimeMs: result.data.mtimeMs,
      savedContent: content,
      saveState: get().content === content ? 'saved' : 'idle'
    })
  }

  /** 取消挂起的自动保存（文件已不在、或退出前要立刻写） */
  const cancelAutosave = (): void => {
    if (!autosaveTimer) return
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }

  return {
    ready: false,
    info: null,
    tree: [],
    activePath: null,
    notice: null,
    defaultVaultPath: null,
    createDialog: null,
    createBusy: false,
    createError: null,
    ...EMPTY_EDITOR,

    setNotice: (message) => set({ notice: message }),

    loadCurrentVault: async () => {
      const result = await window.notes.vault.current()
      if (!result.ok) {
        set({ ready: true, notice: result.error })
        return
      }
      applyVaultState(result.data)
      set({ ready: true })
    },

    loadDefaultVaultPath: async () => {
      const result = await window.notes.vault.defaultPath()
      if (result.ok) set({ defaultVaultPath: result.data })
    },

    useDefaultVault: async () => {
      const expected = get().defaultVaultPath
      const result = await window.notes.vault.useDefault()
      if (!result.ok) {
        set({ notice: result.error })
        return
      }

      // 首选位置被系统拒绝时会落到备用位置，这种情况必须说一声，
      // 否则用户按界面上写的去访达里找，会找不到自己的笔记
      const actual = result.data.info?.rootPath ?? null
      set({
        notice:
          expected && actual && expected !== actual
            ? `系统不允许写入 ${expected}，笔记库改在了 ${actual}`
            : null,
        activePath: null,
        ...EMPTY_EDITOR
      })
      applyVaultState(result.data)
    },

    chooseVault: async () => {
      const result = await window.notes.vault.select()
      if (!result.ok) {
        set({ notice: result.error })
        return
      }
      // 用户取消选择时 data 为 null，此时保持当前笔记库不变
      if (!result.data) return

      set({ notice: null, activePath: null, ...EMPTY_EDITOR })
      applyVaultState(result.data)
    },

    refreshTree: async () => {
      const result = await window.notes.vault.tree()
      if (!result.ok) {
        set({ notice: result.error })
        return
      }
      set({ tree: result.data })
    },

    openFile: async (relPath) => {
      // 切走之前先把当前文件写完，否则未落盘的编辑会丢
      await get().save()

      // 只有真的换文件才清空编辑区。重新读取同一个文件时保留原内容，
      // 否则编辑器会被卸载重建，光标位置和撤销历史都会丢。
      const switchingFile = get().activePath !== relPath
      if (switchingFile) set({ activePath: relPath, ...EMPTY_EDITOR })

      // 图片没有可编辑的文本，不存在「读进来」这一步，直接交给内容区渲染
      if (isImageFile(relPath)) {
        set({ notice: null })
        return
      }

      const result = await window.notes.file.read(relPath)
      if (!result.ok) {
        set({ notice: result.error })
        return
      }

      // 读取期间用户可能已经切到别的文件，丢弃过期结果
      if (get().activePath !== relPath) return

      set({
        content: result.data.content,
        savedContent: result.data.content,
        mtimeMs: result.data.mtimeMs,
        notice: null
      })
    },

    setContent: (next) => {
      set({ content: next, saveState: 'idle' })

      if (autosaveTimer) clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null
        void get().save()
      }, AUTOSAVE_DEBOUNCE_MS)
    },

    save: async () => {
      cancelAutosave()
      await persist()
    },

    revealVault: async () => {
      const result = await window.notes.vault.reveal()
      if (!result.ok) set({ notice: result.error })
    },

    openCreateDialog: (kind, parentPath) => {
      // 目标目录由调用方给定：右键菜单按右键的位置算，
      // 之前那种「跟随当前打开的笔记」的猜测在有右键菜单后不再需要
      set({ createDialog: { kind, parentPath }, createError: null, createBusy: false })
    },

    closeCreateDialog: () => set({ createDialog: null, createError: null }),

    submitCreate: async (name) => {
      const dialog = get().createDialog
      if (!dialog) return

      set({ createBusy: true, createError: null })

      const input = { parentPath: dialog.parentPath, name }
      const result =
        dialog.kind === 'note'
          ? await window.notes.file.create(input)
          : await window.notes.folder.create(input)

      if (!result.ok) {
        set({ createBusy: false, createError: result.error })
        return
      }

      set({ createBusy: false, createDialog: null })
      await get().refreshTree()
      // 新建笔记直接打开，用户不用再去树里找一次
      if (dialog.kind === 'note') await get().openFile(result.data.path)
    },

    handleWatchEvent: (payload) => {
      const { activePath, content, savedContent, mtimeMs } = get()
      const dirty = content !== null && content !== savedContent

      if (payload.type === 'change') {
        if (!activePath || payload.path !== activePath) return

        // 自己刚写入的那次改动也会以 change 事件回来。用 mtime 认出来并忽略，
        // 否则每次自动保存都会被判为「外部修改」而重载文件，把光标打回行首。
        if (payload.mtimeMs !== undefined && mtimeMs !== null && payload.mtimeMs === mtimeMs) {
          return
        }

        if (dirty) {
          // 有未保存的编辑时不重载：那会把用户正在写的内容直接冲掉
          set({ notice: '文件已被外部修改。为免覆盖你正在编辑的内容，已暂停自动重载' })
          return
        }

        void get().openFile(activePath)
        return
      }

      if (payload.type === 'unlink' && activePath) {
        // 目录被删时其下所有文件都失效
        if (payload.path === activePath || activePath.startsWith(`${payload.path}/`)) {
          // 挂起的自动保存要撤掉：它会对着已经不存在的路径写一次，
          // 报出「文件已不存在」，把真正要紧的那条提示顶掉
          cancelAutosave()

          if (dirty) {
            // 同样不清空：内容还在编辑器里，用户至少能另存
            set({ notice: '文件已被外部删除，编辑器中的内容尚未保存，请尽快另存到别处' })
          } else {
            set({ activePath: null, ...EMPTY_EDITOR })
          }
        }
      }

      if (treeRefreshTimer) clearTimeout(treeRefreshTimer)
      treeRefreshTimer = setTimeout(() => {
        treeRefreshTimer = null
        void get().refreshTree()
      }, TREE_REFRESH_DEBOUNCE_MS)
    }
  }
})
