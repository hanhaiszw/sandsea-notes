import { contextBridge, ipcRenderer } from 'electron'

import { IpcChannel, type NotesApi, type WatchPayload } from '@shared/ipc'
import { toPlatformId } from '@shared/platform'
import type { ResolvedTheme } from '@shared/theme'

/** 主进程在创建窗口时通过启动参数注入的只读信息（目前是主题与版本号） */
function readInjectedArg(prefix: string): string | null {
  const arg = process.argv.find((item) => item.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

/** 首帧配色必须在渲染之前定下来，否则浅色主题下会闪一下深色底 */
function readInitialTheme(): ResolvedTheme {
  return readInjectedArg('--notes-theme=') === 'light' ? 'light' : 'dark'
}

/**
 * 安全桥（方案 §4.1）。
 *
 * 只逐个暴露白名单方法，不提供通用的 invoke(channel, ...) 入口，
 * 否则渲染进程一旦被注入即可调用任意主进程能力。
 */
const api: NotesApi = {
  platform: toPlatformId(process.platform),
  initialTheme: readInitialTheme(),
  version: readInjectedArg('--notes-version=') ?? '',

  vault: {
    select: () => ipcRenderer.invoke(IpcChannel.vaultSelect),
    switch: (rootPath) => ipcRenderer.invoke(IpcChannel.vaultSwitch, rootPath),
    current: () => ipcRenderer.invoke(IpcChannel.vaultCurrent),
    clear: () => ipcRenderer.invoke(IpcChannel.vaultClear),
    tree: () => ipcRenderer.invoke(IpcChannel.vaultTree),
    reveal: () => ipcRenderer.invoke(IpcChannel.vaultReveal),
    defaultPath: () => ipcRenderer.invoke(IpcChannel.vaultDefaultPath),
    useDefault: () => ipcRenderer.invoke(IpcChannel.vaultUseDefault)
  },

  file: {
    read: (relPath) => ipcRenderer.invoke(IpcChannel.fileRead, relPath),
    write: (relPath, content, baseMtimeMs) =>
      ipcRenderer.invoke(IpcChannel.fileWrite, relPath, content, baseMtimeMs),
    create: (input) => ipcRenderer.invoke(IpcChannel.fileCreate, input)
  },

  folder: {
    create: (input) => ipcRenderer.invoke(IpcChannel.folderCreate, input)
  },

  asset: {
    saveImage: (input) => ipcRenderer.invoke(IpcChannel.assetSaveImage, input)
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IpcChannel.clipboardWriteText, text),
    readText: () => ipcRenderer.invoke(IpcChannel.clipboardReadText)
  },

  prefs: {
    get: () => ipcRenderer.invoke(IpcChannel.prefsGet),
    set: (next) => ipcRenderer.invoke(IpcChannel.prefsSet, next)
  },

  git: {
    status: () => ipcRenderer.invoke(IpcChannel.gitStatus),
    config: () => ipcRenderer.invoke(IpcChannel.gitConfig),
    setup: (input) => ipcRenderer.invoke(IpcChannel.gitSetup, input),
    clearCredential: () => ipcRenderer.invoke(IpcChannel.gitClearCredential),
    clone: (input) => ipcRenderer.invoke(IpcChannel.gitClone, input),
    sync: (message) => ipcRenderer.invoke(IpcChannel.gitSync, message),
    commit: (message) => ipcRenderer.invoke(IpcChannel.gitCommit, message),
    pull: () => ipcRenderer.invoke(IpcChannel.gitPull),
    initLocal: () => ipcRenderer.invoke(IpcChannel.gitInitLocal),
    history: () => ipcRenderer.invoke(IpcChannel.gitHistory),
    commitFiles: (oid) => ipcRenderer.invoke(IpcChannel.gitCommitFiles, oid),
    fileDiff: (oid, filePath) => ipcRenderer.invoke(IpcChannel.gitFileDiff, oid, filePath),
    workingDiff: (filePath) => ipcRenderer.invoke(IpcChannel.gitWorkingDiff, filePath),
    workingStats: () => ipcRenderer.invoke(IpcChannel.gitWorkingStats),
    restoreFile: (oid, filePath) => ipcRenderer.invoke(IpcChannel.gitRestoreFile, oid, filePath)
  },

  onWatchEvent: (callback) => {
    const listener = (_event: unknown, payload: WatchPayload): void => callback(payload)
    ipcRenderer.on(IpcChannel.watchEvent, listener)
    return () => {
      ipcRenderer.off(IpcChannel.watchEvent, listener)
    }
  },

  onFlushRequest: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannel.appFlush, listener)
    return () => {
      ipcRenderer.off(IpcChannel.appFlush, listener)
    }
  },

  flushDone: () => ipcRenderer.invoke(IpcChannel.appFlushDone)
}

contextBridge.exposeInMainWorld('notes', api)
