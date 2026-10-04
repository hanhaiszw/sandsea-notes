import { clipboard, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron'

import type {
  CommitFile,
  CommitSummary,
  FileDiff,
  GitConnectInput,
  GitSetupInput,
  LineStat
} from '@shared/git'
import {
  IpcChannel,
  type CreateEntryInput,
  type FileContent,
  type Result,
  type SaveImageInput,
  type VaultState
} from '@shared/ipc'
import type { FileNode } from '@shared/notes'
import type { Preferences } from '@shared/theme'
import { WINDOW_BACKGROUND, resolveTheme } from '@shared/theme'

import { readPreferences, writePreferences } from '../services/config'
import * as gitService from '../services/git'
import { notifyFlushDone } from '../services/lifecycle'
import * as vault from '../services/vault'
import { startWatching, stopWatching } from '../services/watcher'

/**
 * IPC 注册（方案 §6）。
 *
 * 统一返回 Result 而非抛出异常：错误信息需要跨进程传递，裸异常在渲染侧只会变成
 * "Error invoking remote method" 这类无法使用的文本。
 */
async function run<T>(task: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await task() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /**
   * 把文件监听绑到「当前笔记库」上。
   * 必须等新旧 watcher 交替完成，否则换库瞬间旧目录的事件会报成新库的改动。
   */
  const bindWatcher = async (state: VaultState): Promise<void> => {
    if (!state.info) {
      await stopWatching()
      return
    }

    const { rootPath } = state.info
    await startWatching(rootPath, (payload) => {
      getWindow()?.webContents.send(IpcChannel.watchEvent, payload)
    })
  }

  ipcMain.handle(IpcChannel.vaultSelect, () =>
    run(async () => {
      const state = await vault.selectVault()
      if (state) await bindWatcher(state)
      return state
    })
  )

  ipcMain.handle(IpcChannel.vaultSwitch, (_event, rootPath: string) =>
    run(async () => {
      const state = await vault.activateVault(rootPath)
      await bindWatcher(state)
      return state
    })
  )

  ipcMain.handle(IpcChannel.vaultCurrent, () =>
    run(async () => {
      const state = await vault.currentVaultState()
      await bindWatcher(state)
      return state
    })
  )

  ipcMain.handle(IpcChannel.vaultClear, () =>
    run(async () => {
      await vault.clearVault()
      await stopWatching()
      return null
    })
  )

  ipcMain.handle(IpcChannel.vaultTree, () =>
    run<FileNode[]>(async () => vault.scanTree(vault.requireVaultRoot()))
  )

  ipcMain.handle(IpcChannel.vaultReveal, () =>
    run(async () => {
      const root = vault.requireVaultRoot()
      const message = await shell.openPath(root)
      if (message) throw new Error(message)
      return null
    })
  )

  ipcMain.handle(IpcChannel.vaultDefaultPath, () => run(() => vault.defaultVaultPath()))

  ipcMain.handle(IpcChannel.vaultUseDefault, () =>
    run(async () => {
      const state = await vault.activateDefaultVault()
      await bindWatcher(state)
      return state
    })
  )

  ipcMain.handle(IpcChannel.fileRead, (_event, relPath: string) =>
    run<FileContent>(async () => vault.readNoteFile(relPath))
  )

  ipcMain.handle(
    IpcChannel.fileWrite,
    (_event, relPath: string, content: string, baseMtimeMs: number | null) =>
      run(async () => vault.writeNoteFile(relPath, content, baseMtimeMs))
  )

  ipcMain.handle(IpcChannel.prefsGet, () => run(async () => readPreferences()))

  // 渲染层报告「退出前的内容已经落盘」，放行被拦下的退出流程
  ipcMain.handle(IpcChannel.appFlushDone, () =>
    run(async () => {
      notifyFlushDone()
      return null
    })
  )

  ipcMain.handle(IpcChannel.prefsSet, (_event, next: Partial<Preferences>) =>
    run(async () => {
      const preferences = writePreferences(next)
      // 同步窗口底色，避免切换主题后缩放窗口时露出上一套配色
      const theme = resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors)
      getWindow()?.setBackgroundColor(WINDOW_BACKGROUND[theme])
      return preferences
    })
  )

  ipcMain.handle(IpcChannel.fileCreate, (_event, input: CreateEntryInput) =>
    run(async () => vault.createEntry(input, 'note'))
  )

  ipcMain.handle(IpcChannel.folderCreate, (_event, input: CreateEntryInput) =>
    run(async () => vault.createEntry(input, 'folder'))
  )

  ipcMain.handle(IpcChannel.assetSaveImage, (_event, input: SaveImageInput) =>
    run(async () => vault.saveImage(input))
  )

  ipcMain.handle(IpcChannel.clipboardWriteText, (_event, text: string) =>
    run(async () => {
      clipboard.writeText(text)
      return null
    })
  )

  ipcMain.handle(IpcChannel.clipboardReadText, () => run(async () => clipboard.readText()))

  ipcMain.handle(IpcChannel.gitStatus, () => run(async () => gitService.getStatus()))

  ipcMain.handle(IpcChannel.gitConfig, () => run(async () => gitService.getConfig()))

  ipcMain.handle(IpcChannel.gitSetup, (_event, input: GitSetupInput) =>
    run(async () => gitService.setup(input))
  )

  ipcMain.handle(IpcChannel.gitClearCredential, () =>
    run(async () => {
      gitService.clearCredential()
      return null
    })
  )

  ipcMain.handle(IpcChannel.gitClone, (_event, input: GitConnectInput) =>
    run(async () => gitService.clone(input))
  )

  ipcMain.handle(IpcChannel.gitSync, (_event, message?: string) =>
    run(async () => gitService.sync(message))
  )

  ipcMain.handle(IpcChannel.gitCommit, (_event, message?: string) =>
    run(async () => gitService.commitOnly(message))
  )

  ipcMain.handle(IpcChannel.gitPull, () => run(async () => gitService.pull()))

  ipcMain.handle(IpcChannel.gitInitLocal, () => run(async () => gitService.initLocalOnly()))

  ipcMain.handle(IpcChannel.gitHistory, () =>
    run<CommitSummary[]>(async () => gitService.history())
  )

  ipcMain.handle(IpcChannel.gitCommitFiles, (_event, oid: string) =>
    run<CommitFile[]>(async () => gitService.commitFiles(oid))
  )

  ipcMain.handle(IpcChannel.gitFileDiff, (_event, oid: string, filePath: string) =>
    run<FileDiff>(async () => gitService.fileDiff(oid, filePath))
  )

  ipcMain.handle(IpcChannel.gitWorkingDiff, (_event, filePath: string) =>
    run<FileDiff>(async () => gitService.workingFileDiff(filePath))
  )

  ipcMain.handle(IpcChannel.gitWorkingStats, () =>
    run<Record<string, LineStat>>(async () => gitService.workingStats())
  )

  ipcMain.handle(IpcChannel.gitRestoreFile, (_event, oid: string, filePath: string) =>
    run(async () => gitService.restoreFile(oid, filePath))
  )
}
