import { promises as fsp } from 'node:fs'
import path from 'node:path'

import { simpleGit, type SimpleGit } from 'simple-git'

import type { ChangedFile, CommitFile, CommitSummary, FileDiff, GitAuthor } from '@shared/git'
import { toPosix } from '@shared/notes'

import { buildFileDiff } from './diff'
import type { GitProvider, OptionalAuth, PullOutcome } from './provider'
import { workingDiffFrom } from './workingDiff'

const REMOTE = 'origin'

/**
 * 系统 git 后端（可切换）。
 *
 * 优点是与命令行行为完全一致、支持 SSH；缺点是要求本机已安装 git。
 *
 * 凭证通过环境变量 + 一次性 credential helper 传入，绝不写进远程 URL，
 * 避免 token 落进 .git/config 或出现在进程参数里。
 */
export class SystemGitProvider implements GitProvider {
  readonly id = 'system' as const

  async ensureAvailable(): Promise<void> {
    try {
      await simpleGit().raw(['--version'])
    } catch {
      throw new Error('未检测到系统 git。请先安装 git，或在设置中改回内置实现')
    }
  }

  async isRepo(dir: string): Promise<boolean> {
    const stat = await fsp.stat(path.join(dir, '.git')).catch(() => null)
    return stat !== null
  }

  async init(dir: string, branch: string): Promise<void> {
    if (await this.isRepo(dir)) return
    await plain(dir).raw(['init', `--initial-branch=${branch}`])
  }

  async setRemote(dir: string, url: string): Promise<void> {
    const git = plain(dir)
    const remotes = await git.getRemotes(true).catch(() => [])
    if (remotes.some((item) => item.name === REMOTE)) {
      await git.remote(['set-url', REMOTE, url])
      return
    }
    await git.addRemote(REMOTE, url)
  }

  async remoteUrl(dir: string): Promise<string | null> {
    const remotes = await plain(dir)
      .getRemotes(true)
      .catch(() => [])
    return remotes.find((item) => item.name === REMOTE)?.refs.fetch ?? null
  }

  async currentBranch(dir: string): Promise<string | null> {
    const git = plain(dir)
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null)
    if (branch && branch.trim() !== 'HEAD') return branch.trim()

    // 尚无提交时 HEAD 是 unborn，直接读符号引用
    const symbolic = await git.raw(['symbolic-ref', '--short', 'HEAD']).catch(() => null)
    return symbolic?.trim() ?? null
  }

  async changedFiles(dir: string): Promise<ChangedFile[]> {
    const status = await plain(dir).status()
    return status.files
      .map((file) => ({ path: toPosix(file.path), kind: kindOf(file.index, file.working_dir) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  async workingFileDiff(dir: string, filePath: string): Promise<FileDiff> {
    // HEAD 里取不到这个文件（新文件，或仓库还没有提交）时 before 为 null，视作空
    return workingDiffFrom(dir, filePath, await showFile(dir, 'HEAD', filePath))
  }

  async commitAll(dir: string, message: string, author: GitAuthor): Promise<string> {
    const git = plain(dir)

    // 提交署名写入仓库本地配置：用户的全局 git 配置可能不存在，不能依赖它
    await git.addConfig('user.name', author.name)
    await git.addConfig('user.email', author.email)

    await git.add(['-A'])
    const result = await git.commit(message)
    return result.commit || (await git.revparse(['HEAD'])).trim()
  }

  async remoteAhead(dir: string, branch: string, auth: OptionalAuth): Promise<boolean> {
    const git = withGit(dir, auth)

    if (!(await tryFetch(git, branch))) return false

    const remoteOid = await revParse(git, `refs/remotes/${REMOTE}/${branch}`)
    if (!remoteOid) return false

    const localOid = await revParse(git, 'HEAD')
    // 本地还没有任何提交，远端有内容 → 远端领先
    if (!localOid) return true

    return (await divergence(git, localOid, remoteOid)).behind > 0
  }

  async push(dir: string, branch: string, auth: OptionalAuth): Promise<void> {
    const git = withGit(dir, auth)
    await git.push(REMOTE, branch, ['--set-upstream'])
  }

  async fastForwardPull(dir: string, branch: string, auth: OptionalAuth): Promise<PullOutcome> {
    const git = withGit(dir, auth)

    if (!(await tryFetch(git, branch, true))) {
      throw new Error(`远端没有分支 ${branch}，无可拉取的内容`)
    }

    const remoteOid = await revParse(git, `refs/remotes/${REMOTE}/${branch}`)
    if (!remoteOid) throw new Error(`远端没有分支 ${branch}，无可拉取的内容`)

    const localOid = await revParse(git, 'HEAD')
    if (localOid) {
      const { ahead, behind } = await divergence(git, localOid, remoteOid)
      if (behind === 0) return 'up-to-date'
      // 本地有远端没有的提交 → 无法快进，交给用户手工处理
      if (ahead > 0) return 'diverged'
    }

    await git.raw(['merge', '--ff-only', `${REMOTE}/${branch}`])
    return 'pulled'
  }

  async clone(dir: string, url: string, branch: string, auth: OptionalAuth): Promise<void> {
    const git = withGit(path.dirname(dir), auth)
    await git.clone(url, dir, ['--branch', branch, '--single-branch'])
  }

  async log(dir: string, limit: number): Promise<CommitSummary[]> {
    // 还没有任何提交时 git log 会失败，这里当作空历史
    const result = await plain(dir)
      .log({ maxCount: limit })
      .catch(() => null)
    if (!result) return []

    return result.all.map((item) => ({
      oid: item.hash,
      shortOid: item.hash.slice(0, 7),
      message: item.message.trim(),
      author: item.author_name,
      timestamp: new Date(item.date).getTime()
    }))
  }

  async commitFiles(dir: string, oid: string): Promise<CommitFile[]> {
    // --format= 去掉提交头部，只留 name-status 行；根提交会与空树比较，全部算新增
    const output = await plain(dir).raw(['show', '--name-status', '--format=', oid])
    const changed = parseNameStatus(output)

    // 行数统计直接复用单文件差异：`oid^` 在根提交上取不到，fileDiff 会当作「之前没有」
    return Promise.all(
      changed.map(async (file) => {
        const diff = await this.fileDiff(dir, oid, file.path)
        return { ...file, added: diff.added, removed: diff.removed, skipped: diff.skipped }
      })
    )
  }

  async fileDiff(dir: string, oid: string, filePath: string): Promise<FileDiff> {
    // `oid^` 在根提交上不存在，取不到就当作「之前没有这个文件」
    const before = await showFile(dir, `${oid}^`, filePath)
    const after = await showFile(dir, oid, filePath)
    return buildFileDiff(filePath, before ?? '', after ?? '')
  }

  async restoreFile(dir: string, oid: string, filePath: string): Promise<void> {
    await plain(dir).raw(['checkout', oid, '--', filePath])
  }
}

/** 读某个版本下某个文件的文本内容；该版本没有这个文件时返回 null */
async function showFile(dir: string, rev: string, filePath: string): Promise<string | null> {
  return plain(dir)
    .show([`${rev}:${filePath}`])
    .catch(() => null)
}

/**
 * 解析 `git show --name-status` 的输出。
 * 形如 `M\t笔记.md`；重命名是 `R100\t旧\t新`，这里取新路径并按「修改」处理。
 *
 * 只解析出路径与变更类型，行数由调用方再去算 —— 那一步要走完整的内容对比。
 */
function parseNameStatus(output: string): Array<{ path: string; kind: CommitFile['kind'] }> {
  const files: Array<{ path: string; kind: CommitFile['kind'] }> = []

  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (line === '') continue

    const fields = line.split('\t')
    if (fields.length < 2) continue

    const status = fields[0][0]
    const target = fields.length >= 3 ? fields[2] : fields[1]
    const kind = status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified'
    files.push({ path: toPosix(target), kind })
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function plain(dir: string): SimpleGit {
  return simpleGit({ baseDir: dir })
}

/** 允许显式注入子进程的环境变量（simple-git 的环境守卫默认拒绝这些名字） */
const ALLOWED_ENV_KEYS = ['GIT_TERMINAL_PROMPT', 'NOTES_GIT_USER', 'NOTES_GIT_TOKEN']

/**
 * 环境守卫会拒绝的变量：任何 GIT_* 前缀，以及 EDITOR / PAGER / VISUAL。
 * 对非交互式的 git 调用来说这些都没有意义（我们从不打开编辑器或分页器），
 * 主动剔除以避免把开发环境的配置带进子进程。
 */
function isGuardedEnvKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.startsWith('git_') || lower === 'editor' || lower === 'pager' || lower === 'visual'
}

/**
 * 构造子进程环境。
 *
 * 注意 `.env()` 传入的对象会整体替换 process.env，因此必须自己带上 PATH / HOME，
 * 否则 git 找不到全局配置与可执行文件。
 */
function buildEnv(auth: OptionalAuth): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (isGuardedEnvKey(key)) continue
    env[key] = value
  }

  // 缺少凭证时直接失败，不要在后台挂起等待输入
  env['GIT_TERMINAL_PROMPT'] = '0'

  if (auth) {
    env['NOTES_GIT_USER'] = auth.username
    env['NOTES_GIT_TOKEN'] = auth.password
  }

  return env
}

function withGit(dir: string, auth: OptionalAuth): SimpleGit {
  const config: string[] = []

  if (auth) {
    // 先清空系统凭证助手，确保本次使用应用里配置的令牌
    config.push(
      'credential.helper=',
      'credential.helper=!f() { echo username=$NOTES_GIT_USER; echo password=$NOTES_GIT_TOKEN; }; f'
    )
  }

  return simpleGit({ baseDir: dir, config, allowEnvironment: ALLOWED_ENV_KEYS }).env(buildEnv(auth))
}

async function tryFetch(git: SimpleGit, branch: string, rethrowMissingBranch = false): Promise<boolean> {
  try {
    await git.fetch(REMOTE, branch)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missing = /couldn't find remote ref|Remote branch .* not found/i.test(message)
    if (missing) {
      if (rethrowMissingBranch) throw new Error(`远端没有分支 ${branch}`)
      return false
    }
    throw error
  }
}

interface Divergence {
  /** 本地有、远端没有的提交数 */
  ahead: number
  /** 远端有、本地没有的提交数 */
  behind: number
}

/**
 * 用 rev-list 计数判断两侧的分叉情况。
 *
 * 刻意不用 `merge-base --is-ancestor`：该命令用退出码表达结果且 stderr 为空，
 * 而 simple-git 的错误检测基于 stderr，会把「退出码 1」当成成功，
 * 导致祖先判断恒为真（进而使分叉检测完全失效）。
 * `rev-list --left-right --count` 退出码恒为 0，并直接给出两侧的提交数。
 */
async function divergence(git: SimpleGit, localOid: string, remoteOid: string): Promise<Divergence> {
  const output = await git.raw([
    'rev-list',
    '--left-right',
    '--count',
    `${localOid}...${remoteOid}`
  ])
  const [ahead = '0', behind = '0'] = output.trim().split(/\s+/)
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 }
}

async function revParse(git: SimpleGit, ref: string): Promise<string | null> {
  const value = await git.revparse([ref]).catch(() => null)
  return value ? value.trim() : null
}

function kindOf(index: string, workingDir: string): ChangedFile['kind'] {
  if (index === '?' || workingDir === '?') return 'added'
  if (index === 'D' || workingDir === 'D') return 'deleted'
  if (index === 'A') return 'added'
  return 'modified'
}
