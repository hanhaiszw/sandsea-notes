import type {
  ChangedFile,
  CommitFile,
  CommitSummary,
  FileDiff,
  GitAuthor,
  GitBackend
} from '@shared/git'

/**
 * Git 后端抽象（方案 §5.3）。
 *
 * 同步流程（判断远端是否领先、何时提交、何时推送）在 GitService 中只实现一次，
 * 后端只提供这些原语，因此新增后端不影响业务逻辑。
 */

export interface GitAuth {
  username: string
  password: string
}

/** 未保存令牌时为 null：SSH 与本地路径远程不需要凭证 */
export type OptionalAuth = GitAuth | null

export type PullOutcome = 'up-to-date' | 'pulled' | 'diverged'

export interface GitProvider {
  readonly id: GitBackend

  /** 后端是否可用（例如系统 git 是否已安装），不可用则抛错 */
  ensureAvailable(): Promise<void>

  isRepo(dir: string): Promise<boolean>

  init(dir: string, branch: string): Promise<void>

  setRemote(dir: string, url: string): Promise<void>

  /** 未配置远程时返回 null */
  remoteUrl(dir: string): Promise<string | null>

  /** 尚未产生任何提交时可能返回 null */
  currentBranch(dir: string): Promise<string | null>

  /** 工作区相对 HEAD 的变更，已排除被 .gitignore 忽略的文件 */
  changedFiles(dir: string): Promise<ChangedFile[]>

  /** 工作区里某个文件相对 HEAD 的行级差异，也就是还没提交的那份改动 */
  workingFileDiff(dir: string, filePath: string): Promise<FileDiff>

  /** 暂存全部变更并提交，返回新提交的 oid */
  commitAll(dir: string, message: string, author: GitAuthor): Promise<string>

  /** fetch 后判断远端分支是否含有本地没有的提交 */
  remoteAhead(dir: string, branch: string, auth: OptionalAuth): Promise<boolean>

  push(dir: string, branch: string, auth: OptionalAuth): Promise<void>

  /** 仅快进式拉取；无法快进时返回 diverged，由调用方提示用户手工处理 */
  fastForwardPull(dir: string, branch: string, auth: OptionalAuth): Promise<PullOutcome>

  clone(dir: string, url: string, branch: string, auth: OptionalAuth): Promise<void>

  /* ── 历史：只读 + 单文件恢复 ── */

  /** 最近的提交，按时间倒序；仓库还没有任何提交时返回空数组 */
  log(dir: string, limit: number): Promise<CommitSummary[]>

  /**
   * 某次提交相对其父提交改了哪些文件（根提交则相对空树，全部算新增），
   * 每条记录带上行级统计，供列表直接展示 +N/−M。
   */
  commitFiles(dir: string, oid: string): Promise<CommitFile[]>

  /** 某个文件在该提交与其父提交之间的行级差异 */
  fileDiff(dir: string, oid: string, filePath: string): Promise<FileDiff>

  /**
   * 把某个文件恢复成它在该提交时的内容。
   * 只改工作区与索引，**不产生提交** —— 恢复出来的是「一个待提交的改动」，
   * 由用户自己确认后再提交，避免悄悄改写历史。
   */
  restoreFile(dir: string, oid: string, filePath: string): Promise<void>
}
