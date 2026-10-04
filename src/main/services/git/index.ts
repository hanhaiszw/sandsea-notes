import { promises as fs } from 'node:fs'
import path from 'node:path'

import { dialog } from 'electron'

import {
  HISTORY_PAGE_SIZE,
  DEFAULT_GITIGNORE,
  SKIPPED_LINE_STAT,
  buildCommitMessage,
  skippedDiff,
  type CommitFile,
  type CommitSummary,
  type FileDiff,
  type GitCommitResult,
  type GitConfig,
  type GitConnectInput,
  type GitPullResult,
  type GitRepoState,
  type GitSetupInput,
  type GitSetupResult,
  type GitStatus,
  type GitSyncResult,
  type LineStat
} from '@shared/git'
import { extname, isImageExtension } from '@shared/notes'

import { readGitConfig, writeGitConfig } from '../config'
import { resolveInsideRoot } from '../paths'
import { activateVault, optionalVaultRoot, requireVaultRoot } from '../vault'
import * as credentials from './credentials'
import { IsomorphicGitProvider } from './isomorphicProvider'
import type { GitAuth, GitProvider } from './provider'
import { SystemGitProvider } from './systemProvider'

/**
 * Git 同步门面（方案 §5.3）。
 *
 * 同步策略：保存落盘 → 手动一键同步。
 * 同步顺序刻意设计成「先检查远端，再提交，最后推送」：
 * 若远端存在本地没有的提交，就直接返回 behind，不产生一个注定推不上去的提交。
 * 任何情况下都不执行 rebase / force push。
 */

function providerFor(config: GitConfig): GitProvider {
  return config.backend === 'system' ? new SystemGitProvider() : new IsomorphicGitProvider()
}

/** 未保存令牌时返回 null：SSH 与本地路径远程本就不需要凭证 */
function currentAuth(config: GitConfig): GitAuth | null {
  const token = credentials.readToken()
  if (!token) return null
  // GitHub 接受任意非空账号名，Gitee 需要真实的账号名
  return { username: config.username || 'x-access-token', password: token }
}

/**
 * 只有 HTTP(S) 远程才需要令牌。
 * 在这里提前拦截，是为了给出「去设置里填令牌」这句可操作的话，
 * 而不是让用户面对 git 抛出的底层认证错误。
 */
function requireAuthIfNeeded(config: GitConfig, remoteUrl: string): GitAuth | null {
  const auth = currentAuth(config)
  if (!auth && /^https?:/i.test(remoteUrl)) {
    throw new Error('该远程使用 HTTP(S) 协议，请先在同步设置中保存访问令牌')
  }
  return auth
}

function requireRemote(config: GitConfig): string {
  if (!config.remoteUrl) throw new Error('请先填写远程仓库地址')
  return config.remoteUrl
}

function requireAuthor(config: GitConfig): void {
  if (!config.author.name || !config.author.email) {
    throw new Error('请先填写提交署名（姓名与邮箱），否则 Git 无法生成提交')
  }
}

export function getConfig(): GitConfig {
  return readGitConfig()
}

/** 清除本机保存的访问令牌；下次同步需要重新填写 */
export function clearCredential(): void {
  credentials.clearToken()
}

export async function getStatus(): Promise<GitStatus> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)
  const hasCredential = credentials.hasToken()

  if (!(await provider.isRepo(dir))) {
    return {
      state: 'no-repo',
      branch: null,
      remoteUrl: null,
      changed: [],
      hasCredential,
      requiresCredential: false,
      suggestedMessage: buildCommitMessage()
    }
  }

  const branch = (await provider.currentBranch(dir)) ?? config.branch
  const remoteUrl = (await provider.remoteUrl(dir)) ?? (config.remoteUrl || null)
  const changed = await provider.changedFiles(dir)
  const state: GitRepoState = remoteUrl ? 'ready' : 'no-remote'

  return {
    state,
    branch,
    remoteUrl,
    changed,
    hasCredential,
    requiresCredential: remoteUrl !== null && /^https?:/i.test(remoteUrl),
    suggestedMessage: buildCommitMessage()
  }
}

export async function setup(input: GitSetupInput): Promise<GitSetupResult> {
  const current = readGitConfig()

  const next: GitConfig = {
    backend: input.backend ?? current.backend,
    remoteUrl: input.remoteUrl === undefined ? current.remoteUrl : input.remoteUrl.trim(),
    branch: normalizeBranch(input.branch ?? current.branch),
    username: input.username === undefined ? current.username : input.username.trim(),
    author: {
      name: input.authorName === undefined ? current.author.name : input.authorName.trim(),
      email: input.authorEmail === undefined ? current.author.email : input.authorEmail.trim()
    }
  }
  writeGitConfig(next)

  let credentialPersisted = true
  if (input.token) {
    credentialPersisted = credentials.saveToken(input.token)
  }

  // 顺手把远程地址写进 .git/config，让「改地址」立即生效。
  // 笔记库打开时会自动建好仓库，所以这里几乎总是命中
  const dir = optionalVaultRoot()
  if (dir && next.remoteUrl) {
    const provider = providerFor(next)
    if (await provider.isRepo(dir)) {
      await provider.setRemote(dir, next.remoteUrl)
    }
  }

  return { config: next, credentialPersisted }
}

/**
 * 只把笔记库初始化成本地仓库，不接远程。
 *
 * 正常情况下用不到：打开笔记库时渲染层就会自动开历史。
 * 留着是给「自动开启失败」时的一个手动重试入口。
 */
export async function initLocalOnly(): Promise<GitStatus> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)

  await provider.ensureAvailable()
  await provider.init(dir, config.branch)
  await writeDefaultGitignore(dir)

  return getStatus()
}

/** 把已有远程仓库克隆到本地，成功后切换笔记库 */
export async function clone(input: GitConnectInput): Promise<GitStatus> {
  const { config } = await setup(input)
  const remoteUrl = requireRemote(config)

  const target = input.targetDir ?? (await pickCloneTarget())
  if (!target) throw new Error('已取消选择克隆位置')

  await ensureEmptyDirectory(target)

  const provider = providerFor(config)
  await provider.ensureAvailable()
  await provider.clone(target, remoteUrl, config.branch, requireAuthIfNeeded(config, remoteUrl))

  await activateVault(target)
  return getStatus()
}

export async function sync(message?: string): Promise<GitSyncResult> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)

  await provider.ensureAvailable()
  const remoteUrl = requireRemote(config)
  requireAuthor(config)

  const changed = await provider.changedFiles(dir)
  if (changed.length === 0) {
    return { outcome: 'up-to-date', committed: false, commitOid: null, changedCount: 0 }
  }

  const auth = requireAuthIfNeeded(config, remoteUrl)
  const branch = (await provider.currentBranch(dir)) ?? config.branch

  if (await provider.remoteAhead(dir, branch, auth)) {
    return { outcome: 'behind', committed: false, commitOid: null, changedCount: changed.length }
  }

  const commitOid = await provider.commitAll(
    dir,
    resolveCommitMessage(message),
    config.author
  )
  await provider.push(dir, branch, auth)

  return { outcome: 'pushed', committed: true, commitOid, changedCount: changed.length }
}

/**
 * 仅提交到本地，完全不接触远程。
 *
 * 这是「远端领先 + 本地有改动」这个死局的出口：先让改动进版本历史，
 * 工作区随后变干净，才有可能执行快进拉取。因此这里刻意不校验远程地址与凭证。
 */
export async function commitOnly(message?: string): Promise<GitCommitResult> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)

  await provider.ensureAvailable()
  requireAuthor(config)

  const changed = await provider.changedFiles(dir)
  if (changed.length === 0) {
    return { outcome: 'nothing-to-commit', commitOid: null, changedCount: 0 }
  }

  const commitOid = await provider.commitAll(
    dir,
    resolveCommitMessage(message),
    config.author
  )

  return { outcome: 'committed', commitOid, changedCount: changed.length }
}

export async function pull(): Promise<GitPullResult> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)

  await provider.ensureAvailable()
  const remoteUrl = requireRemote(config)

  // 工作区不干净时不做快进拉取：会覆盖未提交的改动
  const changed = await provider.changedFiles(dir)
  if (changed.length > 0) {
    throw new Error(`本地还有 ${changed.length} 个未提交的改动，请先提交或同步后再拉取`)
  }

  const branch = (await provider.currentBranch(dir)) ?? config.branch
  const outcome = await provider.fastForwardPull(
    dir,
    branch,
    requireAuthIfNeeded(config, remoteUrl)
  )

  if (outcome === 'diverged') {
    throw new Error('本地与远端的历史已经分叉，无法自动拉取。请在外部手工处理后再重试')
  }

  return { outcome: outcome === 'pulled' ? 'pulled' : 'up-to-date' }
}

/* ── 历史与差异（只读 + 单文件恢复） ───────────────────── */

/** 需要仓库的操作的前置：必须已经是个仓库；不是就说清楚该去哪儿建 */
async function repoContext(): Promise<{ provider: GitProvider; dir: string }> {
  const config = readGitConfig()
  const dir = requireVaultRoot()
  const provider = providerFor(config)

  await provider.ensureAvailable()
  if (!(await provider.isRepo(dir))) {
    throw new Error('这个笔记库还没有开启本地版本历史，请到「设置」里点「立即开启」')
  }

  return { provider, dir }
}

export async function history(): Promise<CommitSummary[]> {
  const { provider, dir } = await repoContext()
  return provider.log(dir, HISTORY_PAGE_SIZE)
}

/**
 * Git 后端的入参同样要过笔记库守卫。
 *
 * provider 内部是 `path.join(dir, filePath)` 直接读盘 / 写盘，渲染层传来的
 * `../` 会一路读写到笔记库之外 —— 这条链路上没有任何别的地方会拦它。
 */
async function requireFilePath(dir: string, filePath: string): Promise<string> {
  await resolveInsideRoot(dir, filePath)
  return filePath
}

/** oid 只可能是十六进制；顺带挡住把 git 选项当成 oid 传进来的玩法 */
function requireOid(oid: string): string {
  if (!/^[0-9a-f]{4,64}$/i.test(oid)) throw new Error('提交标识不合法')
  return oid
}

export async function commitFiles(oid: string): Promise<CommitFile[]> {
  const { provider, dir } = await repoContext()
  const files = await provider.commitFiles(dir, requireOid(oid))

  // 图片不给行数：与点开来看时的提示保持一致，否则列表上会出现一堆没有意义的增删计数
  return files.map((file) => (isBinaryByExtension(file.path) ? { ...file, ...SKIPPED_LINE_STAT } : file))
}

export async function fileDiff(oid: string, filePath: string): Promise<FileDiff> {
  const { provider, dir } = await repoContext()
  const target = await requireFilePath(dir, filePath)

  return withBinaryShortCircuit(target, () => provider.fileDiff(dir, requireOid(oid), target))
}

/**
 * 工作区里某个文件相对 HEAD 的差异 —— 也就是提交前「这次改了什么」。
 */
export async function workingFileDiff(filePath: string): Promise<FileDiff> {
  const { provider, dir } = await repoContext()
  const target = await requireFilePath(dir, filePath)

  return withBinaryShortCircuit(target, () => provider.workingFileDiff(dir, target))
}

/** 一次算多少个文件的差异，避免大改动量时把内存与 CPU 同时顶满 */
const DIFF_BATCH_SIZE = 4

/**
 * 工作区里每个待提交文件的行级统计，键是 POSIX 相对路径。
 *
 * 提交弹窗一打开就整张表拉过去，列表上直接显示 +N/−M。逐个文件单独请求会有
 * N 次 IPC 往返，一次算完更省事；但要分批，不能一次性全部并发。
 */
export async function workingStats(): Promise<Record<string, LineStat>> {
  const { provider, dir } = await repoContext()
  const changed = await provider.changedFiles(dir)

  const entries: Array<readonly [string, LineStat]> = []

  for (let start = 0; start < changed.length; start += DIFF_BATCH_SIZE) {
    const batch = changed.slice(start, start + DIFF_BATCH_SIZE)
    entries.push(
      ...(await Promise.all(
        batch.map(async (file) => {
          const diff = await withBinaryShortCircuit(file.path, () =>
            provider.workingFileDiff(dir, file.path)
          )
          return [file.path, { added: diff.added, removed: diff.removed, skipped: diff.skipped }] as const
        })
      ))
    )
  }

  return Object.fromEntries(entries)
}

/** 图片不做行级对比：硬算出来只会是乱码，界面按 skipped 提示即可。 */
function isBinaryByExtension(filePath: string): boolean {
  return isImageExtension(extname(filePath).replace(/^\./, ''))
}

function withBinaryShortCircuit(filePath: string, run: () => Promise<FileDiff>): Promise<FileDiff> {
  if (isBinaryByExtension(filePath)) return Promise.resolve(skippedDiff(filePath))
  return run()
}

/**
 * 把某个文件恢复成它在该提交时的内容。
 *
 * 刻意只改工作区、不自动提交：恢复出来的应当是一个「待提交的改动」，
 * 让用户在正常流程里看一眼、自己决定要不要提交。
 */
export async function restoreFile(oid: string, filePath: string): Promise<null> {
  const { provider, dir } = await repoContext()
  await provider.restoreFile(dir, requireOid(oid), await requireFilePath(dir, filePath))
  return null
}

function normalizeBranch(branch: string): string {
  return branch.trim() || 'main'
}

/** 未填写提交信息时回落到默认模板 */
function resolveCommitMessage(message: string | undefined): string {
  return message?.trim() || buildCommitMessage()
}

async function writeDefaultGitignore(dir: string): Promise<void> {
  const file = path.join(dir, '.gitignore')
  if (await fs.stat(file).catch(() => null)) return
  await fs.writeFile(file, DEFAULT_GITIGNORE, 'utf8')
}

async function pickCloneTarget(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择克隆位置',
    message: '请选择一个空文件夹，仓库会被克隆到其中',
    buttonLabel: '克隆到此处',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function ensureEmptyDirectory(target: string): Promise<void> {
  const stat = await fs.stat(target).catch(() => null)
  if (stat) {
    if (!stat.isDirectory()) throw new Error('克隆位置不是文件夹')
    const entries = await fs.readdir(target)
    if (entries.length > 0) {
      throw new Error('克隆位置不是空文件夹，请换一个空文件夹或新建一个')
    }
    return
  }
  await fs.mkdir(target, { recursive: true })
}
