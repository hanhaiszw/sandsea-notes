import type { FileNode } from './notes'
import type {
  CommitFile,
  CommitSummary,
  FileDiff,
  GitCommitResult,
  GitConfig,
  GitConnectInput,
  GitPullResult,
  GitSetupInput,
  GitSetupResult,
  GitStatus,
  GitSyncResult,
  LineStat
} from './git'
import type { PlatformId } from './platform'
import type { Preferences, ResolvedTheme } from './theme'

/**
 * 主进程 ↔ 渲染进程的 IPC 契约。
 *
 * 通道名集中在此声明，preload 以白名单方式逐个暴露，
 * 不提供 `invoke(channel, ...)` 这类通用入口（方案 §6）。
 */

export const IpcChannel = {
  vaultSelect: 'vault:select',
  vaultSwitch: 'vault:switch',
  vaultCurrent: 'vault:current',
  vaultClear: 'vault:clear',
  vaultTree: 'vault:tree',
  vaultReveal: 'vault:reveal',
  vaultDefaultPath: 'vault:default-path',
  vaultUseDefault: 'vault:use-default',
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileCreate: 'file:create',
  folderCreate: 'folder:create',
  assetSaveImage: 'asset:save-image',
  clipboardWriteText: 'clipboard:write-text',
  clipboardReadText: 'clipboard:read-text',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  watchEvent: 'watch:event',
  appFlush: 'app:flush',
  appFlushDone: 'app:flush-done',
  gitStatus: 'git:status',
  gitConfig: 'git:config',
  gitSetup: 'git:setup',
  gitClearCredential: 'git:clear-credential',
  gitClone: 'git:clone',
  gitSync: 'git:sync',
  gitCommit: 'git:commit',
  gitPull: 'git:pull',
  gitInitLocal: 'git:init-local',
  gitHistory: 'git:history',
  gitCommitFiles: 'git:commit-files',
  gitFileDiff: 'git:file-diff',
  gitWorkingDiff: 'git:working-diff',
  gitWorkingStats: 'git:working-stats',
  gitRestoreFile: 'git:restore-file'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/** IPC 统一返回结构：错误不抛出，而是显式回传，避免渲染进程拿到裸异常 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface VaultInfo {
  /** 笔记库文件夹名 */
  name: string
  /** 笔记库绝对路径（POSIX 风格，用于展示） */
  rootPath: string
}

export interface VaultState {
  info: VaultInfo | null
  tree: FileNode[]
}

export interface FileContent {
  path: string
  content: string
  /** 读取时的文件修改时间，写回时用于检测外部改动 */
  mtimeMs: number
}

export interface FileWriteResult {
  /** 写入后的修改时间，供下一次写入做冲突检测 */
  mtimeMs: number
}

export interface CreateEntryInput {
  /** 目标父目录的相对路径，空串表示笔记库根目录 */
  parentPath: string
  /** 用户输入的名称（不含路径） */
  name: string
}

export interface CreatedEntry {
  /** 新建条目相对笔记库根目录的 POSIX 路径 */
  path: string
}

export interface SaveImageInput {
  /** 图片二进制内容 */
  data: Uint8Array
  /** 图片格式（不含点），取值见 IMAGE_EXTENSIONS */
  extension: string
}

export interface SavedImage {
  /** 落盘位置相对笔记库根目录的 POSIX 路径，形如 images/image-20260929-153012.png */
  path: string
}

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface WatchPayload {
  type: WatchEventType
  /** 相对笔记库根目录的 POSIX 路径 */
  path: string
  /**
   * 文件修改时间（仅 add / change 事件提供）。
   * 渲染层用它识别「这次变更是不是我自己刚写的那一次」——
   * 否则每次自动保存都会被当成外部修改而重载文件。
   */
  mtimeMs?: number
}

export interface NotesApi {
  readonly platform: PlatformId
  /** 启动时解析出的主题，由主进程通过启动参数注入，用于在首次绘制前就设好配色 */
  readonly initialTheme: ResolvedTheme
  /** 应用版本号，同样由主进程注入；打包后取自 .app 的版本，不是一个写死的常量 */
  readonly version: string
  readonly vault: {
    /** 打开目录选择对话框；用户取消时 data 为 null，此时应保留当前笔记库不变 */
    select(): Promise<Result<VaultState | null>>
    switch(rootPath: string): Promise<Result<VaultState>>
    /** 启动时恢复上次的笔记库 */
    current(): Promise<Result<VaultState>>
    clear(): Promise<Result<null>>
    tree(): Promise<Result<FileNode[]>>
    /** 在系统文件管理器中打开笔记库目录，供用户用外部工具处理冲突 */
    reveal(): Promise<Result<null>>
    /** 首次使用时的默认笔记库位置；只读取，不会创建任何东西 */
    defaultPath(): Promise<Result<string>>
    /** 在默认位置建库并切过去；目录不存在会创建，新建的空目录里会放一篇引导笔记 */
    useDefault(): Promise<Result<VaultState>>
  }
  readonly file: {
    read(relPath: string): Promise<Result<FileContent>>
    /**
     * 写回文件内容。
     * baseMtimeMs 是上次读取 / 写入时的时间戳；与磁盘现状不符说明文件被外部改过，
     * 主进程会拒绝写入而不是静默覆盖。
     */
    write(
      relPath: string,
      content: string,
      baseMtimeMs: number | null
    ): Promise<Result<FileWriteResult>>
    /** 新建笔记；名称只填名字，扩展名由主进程补全 */
    create(input: CreateEntryInput): Promise<Result<CreatedEntry>>
  }
  readonly folder: {
    create(input: CreateEntryInput): Promise<Result<CreatedEntry>>
  }
  readonly asset: {
    /**
     * 把粘贴 / 拖入的图片存进笔记库根目录的 images/。
     * 只接收二进制内容，不接受路径 —— 渲染进程因此无法指使主进程读写任意文件。
     */
    saveImage(input: SaveImageInput): Promise<Result<SavedImage>>
  }
  readonly clipboard: {
    /**
     * 读写系统剪贴板（纯文本），供编辑器右键菜单使用。
     *
     * 走主进程而不是 navigator.clipboard：那条路在沙箱里要过权限那一关，
     * 而主进程本来就有这个能力，也与「特权只留在主进程」的分层一致。
     */
    writeText(text: string): Promise<Result<null>>
    readText(): Promise<Result<string>>
  }
  readonly prefs: {
    get(): Promise<Result<Preferences>>
    set(next: Partial<Preferences>): Promise<Result<Preferences>>
  }
  readonly git: {
    status(): Promise<Result<GitStatus>>
    config(): Promise<Result<GitConfig>>
    setup(input: GitSetupInput): Promise<Result<GitSetupResult>>
    /** 清除本机保存的访问令牌 */
    clearCredential(): Promise<Result<null>>
    /** 把已有远程仓库克隆到本地，成功后自动切换笔记库 */
    clone(input: GitConnectInput): Promise<Result<GitStatus>>
    /** 提交并推送；远端领先时返回 outcome='behind'，不做任何有损操作 */
    sync(message?: string): Promise<Result<GitSyncResult>>
    /** 仅提交到本地，完全不接触远程；用于远端领先时先保住本地改动 */
    commit(message?: string): Promise<Result<GitCommitResult>>
    /** 仅快进式拉取 */
    pull(): Promise<Result<GitPullResult>>
    /** 只把笔记库初始化成本地仓库，不接远程（用于「只用 git 记本地历史」） */
    initLocal(): Promise<Result<GitStatus>>
    /** 最近的提交，按时间倒序 */
    history(): Promise<Result<CommitSummary[]>>
    /** 某次提交改了哪些文件 */
    commitFiles(oid: string): Promise<Result<CommitFile[]>>
    /** 某个文件在该提交与其父提交之间的行级差异 */
    fileDiff(oid: string, filePath: string): Promise<Result<FileDiff>>
    /** 某个文件在当前工作区相对 HEAD 的差异，提交前看「这次改了什么」用 */
    workingDiff(filePath: string): Promise<Result<FileDiff>>
    /** 工作区每个待提交文件的行级统计，键是 POSIX 相对路径 */
    workingStats(): Promise<Result<Record<string, LineStat>>>
    /** 把某个文件恢复成它在该提交时的内容；只改工作区，不自动提交 */
    restoreFile(oid: string, filePath: string): Promise<Result<null>>
  }
  /** 订阅文件变更，返回取消订阅函数 */
  onWatchEvent(callback: (payload: WatchPayload) => void): () => void
  /**
   * 订阅「退出前请立刻落盘」的请求，返回取消订阅函数。
   *
   * 自动保存有 700ms 防抖，直接退出会丢掉最后一小段输入；主进程在退出前
   * 先发这条请求，渲染层写完再调 flushDone 放行。
   */
  onFlushRequest(callback: () => void): () => void
  /** 报告「已经落盘」；主进程收到后才继续退出流程 */
  flushDone(): Promise<Result<null>>
}
