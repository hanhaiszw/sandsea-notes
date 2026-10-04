import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileNode } from '@shared/notes'

import { ContentPane } from './components/ContentPane'
import { ContextMenu } from './components/ContextMenu'
import { CreateEntryDialog } from './components/CreateEntryDialog'
import { EmptyState } from './components/EmptyState'
import { FileTree, type TreeMenuRequest } from './components/FileTree'
import { GitSettingsDialog } from './components/GitSettingsDialog'
import { GitSyncDialog } from './components/GitSyncDialog'
import { HistoryDialog } from './components/HistoryDialog'
import { HoverTip } from './components/HoverTip'
import { StatusBar } from './components/StatusBar'
import { useGitStore } from './store/git'
import { usePrefsStore } from './store/prefsStore'
import { useVaultStore } from './store/vaultStore'

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.type === 'directory' ? countFiles(node.children) : 1),
    0
  )
}

function App() {
  const ready = useVaultStore((state) => state.ready)
  const info = useVaultStore((state) => state.info)
  const tree = useVaultStore((state) => state.tree)
  const notice = useVaultStore((state) => state.notice)
  const loadCurrentVault = useVaultStore((state) => state.loadCurrentVault)
  const loadDefaultVaultPath = useVaultStore((state) => state.loadDefaultVaultPath)
  const defaultVaultPath = useVaultStore((state) => state.defaultVaultPath)
  const chooseVault = useVaultStore((state) => state.chooseVault)
  const useDefaultVault = useVaultStore((state) => state.useDefaultVault)
  const openCreateDialog = useVaultStore((state) => state.openCreateDialog)
  const handleWatchEvent = useVaultStore((state) => state.handleWatchEvent)

  const refreshGit = useGitStore((state) => state.refresh)
  const resetGit = useGitStore((state) => state.reset)
  const notifyGitChange = useGitStore((state) => state.notifyFileChange)
  const loadPrefs = usePrefsStore((state) => state.load)

  useEffect(() => {
    void loadPrefs()
  }, [loadPrefs])

  useEffect(() => {
    void loadCurrentVault()
    return window.notes.onWatchEvent((payload) => {
      handleWatchEvent(payload)
      // 文件变动意味着工作区可能不再干净，需要重算未同步数量
      notifyGitChange()
    })
  }, [handleWatchEvent, notifyGitChange, loadCurrentVault])

  /**
   * 主进程在退出前会先发这条请求，让我们把编辑器里还没落盘的内容写完。
   * 自动保存有 700ms 防抖，不补这一步的话「敲完就退」会丢掉最后一小段输入。
   */
  useEffect(() => {
    return window.notes.onFlushRequest(() => {
      void useVaultStore
        .getState()
        .save()
        .finally(() => void window.notes.flushDone())
    })
  }, [])

  /**
   * 只在还没有笔记库时才算默认位置。
   * 这个调用会真的试建一次目录，已经有笔记库的情况没必要付这个代价。
   */
  useEffect(() => {
    if (!ready || info) return
    void loadDefaultVaultPath()
  }, [ready, info, loadDefaultVaultPath])

  const [menu, setMenu] = useState<TreeMenuRequest | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const vaultRoot = info?.rootPath ?? null
  useEffect(() => {
    if (!vaultRoot) {
      resetGit()
      return
    }
    void refreshGit()
  }, [vaultRoot, refreshGit, resetGit])

  const gitRepoState = useGitStore((state) => state.status?.state ?? null)
  const initLocalHistory = useGitStore((state) => state.initLocal)

  /**
   * 打开一个还不是 Git 仓库的文件夹时，直接把本地版本历史开起来。
   *
   * 本地历史是这个应用的主线用法，不该让用户先去设置里找到那个开关再打开它。
   * ref 记下已经试过的路径：开发模式下 StrictMode 会把 effect 跑两遍，
   * 两次初始化会并发去写 .git。
   */
  const autoInitVault = useRef<string | null>(null)
  useEffect(() => {
    if (!vaultRoot || gitRepoState !== 'no-repo') return
    if (autoInitVault.current === vaultRoot) return

    autoInitVault.current = vaultRoot
    void initLocalHistory()
  }, [vaultRoot, gitRepoState, initLocalHistory])

  if (!ready) return <div className="app" />

  if (!info) {
    return (
      <div className="app">
        <div className="titlebar" />
        <EmptyState
          defaultPath={defaultVaultPath}
          notice={notice}
          onChoose={() => void chooseVault()}
          onUseDefault={() => void useDefaultVault()}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="titlebar" />
      <div className="app__body">
        <aside className="sidebar">
          <header className="vault">
            <p className="vault__label">笔记库</p>
            <h1 className="vault__name">{info.name}</h1>
            <p className="vault__path" title={info.rootPath}>
              {info.rootPath}
            </p>
            <button className="button" onClick={() => void chooseVault()} type="button">
              更换文件夹
            </button>
          </header>

          <div
            className="sidebar__scroll"
            onContextMenu={(event) => {
              // 文件树之外的空白处右键 → 建在笔记库根目录
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, parentPath: '' })
            }}
          >
            {tree.length > 0 ? (
              // 换笔记库时重建组件，避免继承上一个库的展开状态
              <FileTree key={info.rootPath} nodes={tree} onRequestMenu={setMenu} />
            ) : (
              <p className="sidebar__empty">这个文件夹里还没有 Markdown 文件</p>
            )}
          </div>

          <footer className="sidebar__foot">
            <span className="counter">{countFiles(tree)}</span>
            <span>个文件</span>
          </footer>
        </aside>

        <main className="content">
          {notice ? <div className="notice">{notice}</div> : null}
          <ContentPane />
        </main>
      </div>

      <StatusBar />
      <GitSyncDialog />
      <GitSettingsDialog />
      <HistoryDialog />
      <CreateEntryDialog />
      {/* 悬停提示挂在最外层：它要浮在弹窗之上，也不能被列表的 overflow 裁掉 */}
      <HoverTip />

      {menu ? (
        <ContextMenu
          items={[
            {
              id: 'note',
              label: '新建笔记',
              onSelect: () => openCreateDialog('note', menu.parentPath)
            },
            {
              id: 'folder',
              label: '新建文件夹',
              onSelect: () => openCreateDialog('folder', menu.parentPath)
            }
          ]}
          onClose={closeMenu}
          x={menu.x}
          y={menu.y}
        />
      ) : null}
    </div>
  )
}

export default App
