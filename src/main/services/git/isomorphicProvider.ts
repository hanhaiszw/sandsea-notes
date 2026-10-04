import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

import type { ChangedFile, CommitFile, CommitSummary, FileDiff, GitAuthor } from '@shared/git'
import { toPosix } from '@shared/notes'

import { buildFileDiff } from './diff'
import type { GitAuth, GitProvider, OptionalAuth, PullOutcome } from './provider'
import { workingDiffFrom } from './workingDiff'

const REMOTE = 'origin'

/** isomorphic-git 需要回调式 fs 实现，不能传 fs/promises */
const nodeFs = fs

type StageAction = { filepath: string; action: 'add' | 'remove' }

interface MatrixRow {
  filepath: string
  head: number
  workdir: number
  stage: number
}

/**
 * isomorphic-git 后端（默认）。
 * 纯 JS 实现，用户无需安装 git；代价是只支持 HTTPS + Token，不支持 SSH。
 */
export class IsomorphicGitProvider implements GitProvider {
  readonly id = 'isomorphic' as const

  async ensureAvailable(): Promise<void> {
    // 纯 JS 实现，无外部依赖
  }

  async isRepo(dir: string): Promise<boolean> {
    const stat = await fsp.stat(path.join(dir, '.git')).catch(() => null)
    return stat !== null
  }

  async init(dir: string, branch: string): Promise<void> {
    if (await this.isRepo(dir)) return
    await git.init({ fs: nodeFs, dir, defaultBranch: branch })
  }

  async setRemote(dir: string, url: string): Promise<void> {
    const remotes = await git.listRemotes({ fs: nodeFs, dir })
    if (remotes.some((item) => item.remote === REMOTE)) {
      await git.deleteRemote({ fs: nodeFs, dir, remote: REMOTE })
    }
    await git.addRemote({ fs: nodeFs, dir, remote: REMOTE, url })
  }

  async remoteUrl(dir: string): Promise<string | null> {
    const remotes = await git.listRemotes({ fs: nodeFs, dir }).catch(() => [])
    return remotes.find((item) => item.remote === REMOTE)?.url ?? null
  }

  async currentBranch(dir: string): Promise<string | null> {
    const branch = await git
      .currentBranch({ fs: nodeFs, dir, fullname: false })
      .catch(() => null)
    return branch ?? null
  }

  async changedFiles(dir: string): Promise<ChangedFile[]> {
    const rows = await this.readMatrix(dir)
    const changed: ChangedFile[] = []

    for (const row of rows) {
      // statusMatrix 会把仓库里的**每一个**文件都列出来，没改动的行是 [1,1,1]，
      // 不过滤的话「未同步变更数」会等于文件总数
      if (isUnchanged(row)) continue
      if (await git.isIgnored({ fs: nodeFs, dir, filepath: row.filepath })) continue
      changed.push({ path: toPosix(row.filepath), kind: kindOf(row) })
    }

    return changed.sort((a, b) => a.path.localeCompare(b.path))
  }

  async workingFileDiff(dir: string, filePath: string): Promise<FileDiff> {
    // 还没有任何提交时 HEAD 解析不出来，before 视作空，全部算新增
    const head = await tryResolveRef(dir, 'HEAD')
    return workingDiffFrom(dir, filePath, await this.blobText(dir, head, filePath))
  }

  async commitAll(dir: string, message: string, author: GitAuthor): Promise<string> {
    const actions = await this.stagingPlan(dir)
    for (const item of actions) {
      if (item.action === 'remove') {
        await git.remove({ fs: nodeFs, dir, filepath: item.filepath })
      } else {
        await git.add({ fs: nodeFs, dir, filepath: item.filepath })
      }
    }

    return git.commit({
      fs: nodeFs,
      dir,
      message,
      author: { name: author.name, email: author.email }
    })
  }

  async remoteAhead(dir: string, branch: string, auth: OptionalAuth): Promise<boolean> {
    const fetched = await this.tryFetch(dir, branch, auth)
    if (!fetched) return false

    const remoteOid = await tryResolveRef(dir, `refs/remotes/${REMOTE}/${branch}`)
    if (!remoteOid) return false

    const localOid = await tryResolveRef(dir, 'HEAD')
    // 本地还没有任何提交，远端有内容 → 远端领先
    if (!localOid) return true
    if (remoteOid === localOid) return false

    return git.isDescendent({ fs: nodeFs, dir, oid: remoteOid, ancestor: localOid })
  }

  async push(dir: string, branch: string, auth: OptionalAuth): Promise<void> {
    const result = await git.push({
      fs: nodeFs,
      http,
      dir,
      remote: REMOTE,
      ref: branch,
      onAuth: onAuthFor(auth)
    })

    if (!result.ok || result.error) {
      throw new Error(`推送失败：${result.error ?? '未知错误'}`)
    }
  }

  async fastForwardPull(dir: string, branch: string, auth: OptionalAuth): Promise<PullOutcome> {
    await this.tryFetch(dir, branch, auth, true)

    const remoteOid = await tryResolveRef(dir, `refs/remotes/${REMOTE}/${branch}`)
    if (!remoteOid) throw new Error(`远端没有分支 ${branch}，无可拉取的内容`)

    const localOid = await tryResolveRef(dir, 'HEAD')

    if (localOid && localOid === remoteOid) return 'up-to-date'

    // 快进的前提：本地提交是远端的祖先（含本地尚无提交的情况）
    if (localOid && !(await git.isDescendent({ fs: nodeFs, dir, oid: remoteOid, ancestor: localOid }))) {
      return 'diverged'
    }

    await git.writeRef({ fs: nodeFs, dir, ref: `refs/heads/${branch}`, value: remoteOid, force: true })
    await git.checkout({ fs: nodeFs, dir, ref: branch, force: true })
    return 'pulled'
  }

  async clone(dir: string, url: string, branch: string, auth: OptionalAuth): Promise<void> {
    await git.clone({
      fs: nodeFs,
      http,
      dir,
      url,
      ref: branch,
      singleBranch: true,
      onAuth: onAuthFor(auth)
    })
  }

  async log(dir: string, limit: number): Promise<CommitSummary[]> {
    // 还没有任何提交时 readCommit 会抛错，这里直接当作空历史
    const commits = await git.log({ fs: nodeFs, dir, depth: limit }).catch(() => [])

    return commits.map((item) => ({
      oid: item.oid,
      shortOid: item.oid.slice(0, 7),
      message: (item.commit.message ?? '').trim(),
      author: item.commit.author?.name ?? '',
      // isomorphic-git 的时间戳单位是秒，统一换算成毫秒
      timestamp: (item.commit.author?.timestamp ?? 0) * 1000
    }))
  }

  async commitFiles(dir: string, oid: string): Promise<CommitFile[]> {
    const commit = await git.readCommit({ fs: nodeFs, dir, oid })
    const parentOid = commit.commit.parent[0] ?? null

    const after = await this.treeBlobs(dir, oid)
    // 根提交没有父提交，视作与空树比较：全部算新增
    const before = parentOid ? await this.treeBlobs(dir, parentOid) : new Map<string, string>()

    const changed: Array<{ path: string; kind: ChangedFile['kind'] }> = []
    for (const [filepath, blobOid] of after) {
      const previous = before.get(filepath)
      if (previous === undefined) changed.push({ path: toPosix(filepath), kind: 'added' })
      else if (previous !== blobOid) changed.push({ path: toPosix(filepath), kind: 'modified' })
    }
    for (const filepath of before.keys()) {
      if (!after.has(filepath)) changed.push({ path: toPosix(filepath), kind: 'deleted' })
    }

    // 行数统计直接复用单文件差异，省得再写一套「取父子两份内容」的逻辑
    const entries = await Promise.all(
      changed.map(async (file) => {
        const diff = await this.fileDiff(dir, oid, file.path)
        return { ...file, added: diff.added, removed: diff.removed, skipped: diff.skipped }
      })
    )

    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }

  async fileDiff(dir: string, oid: string, filePath: string): Promise<FileDiff> {
    const commit = await git.readCommit({ fs: nodeFs, dir, oid })
    const parentOid = commit.commit.parent[0] ?? null

    const before = await this.blobText(dir, parentOid, filePath)
    const after = await this.blobText(dir, oid, filePath)

    return buildFileDiff(filePath, before ?? '', after ?? '')
  }

  /**
   * 把某个文件恢复成该提交时的内容。
   *
   * 刻意**不用 git.checkout**：它默认会更新 HEAD（源码里是
   * `if (!noUpdateHead) writeSymbolicRef(...)`），哪怕传了 filepaths 也一样 ——
   * 结果就是「恢复一个文件」把 HEAD 挪到了旧提交上，工作区被整体改写。
   * 这里只读 blob 再写回那一个文件，除了这个文件什么都不会变。
   */
  async restoreFile(dir: string, oid: string, filePath: string): Promise<void> {
    const { blob } = await git.readBlob({ fs: nodeFs, dir, oid, filepath: filePath })
    const target = path.join(dir, filePath)

    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, Buffer.from(blob))
  }

  /** 取某次提交（或某个 commit 对象）下的全部文件 → blob oid 映射 */
  private async treeBlobs(dir: string, ref: string): Promise<Map<string, string>> {
    const blobs = new Map<string, string>()

    await git.walk({
      fs: nodeFs,
      dir,
      trees: [git.TREE({ ref })],
      map: async (filepath, entries) => {
        const entry = entries[0]
        if (!entry || filepath === '.') return undefined
        if ((await entry.type()) !== 'blob') return undefined
        blobs.set(filepath, await entry.oid())
        return undefined
      }
    })

    return blobs
  }

  /** 读某个 ref 下某个文件的文本内容；该 ref 下没有这个文件时返回 null */
  private async blobText(
    dir: string,
    ref: string | null,
    filepath: string
  ): Promise<string | null> {
    if (!ref) return null

    try {
      const { blob } = await git.readBlob({ fs: nodeFs, dir, oid: ref, filepath })
      return new TextDecoder().decode(blob)
    } catch {
      return null
    }
  }

  private async tryFetch(
    dir: string,
    branch: string,
    auth: OptionalAuth,
    rethrowMissingBranch = false
  ): Promise<boolean> {
    try {
      await git.fetch({
        fs: nodeFs,
        http,
        dir,
        remote: REMOTE,
        ref: branch,
        singleBranch: true,
        onAuth: onAuthFor(auth)
      })
      return true
    } catch (error) {
      if (isMissingRemoteBranch(error)) {
        if (rethrowMissingBranch) throw new Error(`远端没有分支 ${branch}`)
        return false
      }
      throw error
    }
  }

  private async readMatrix(dir: string): Promise<MatrixRow[]> {
    const matrix = await git.statusMatrix({ fs: nodeFs, dir })
    return matrix.map(([filepath, head, workdir, stage]) => ({ filepath, head, workdir, stage }))
  }

  /** 把「未暂存」的差异转成需要执行的暂存动作 */
  private async stagingPlan(dir: string): Promise<StageAction[]> {
    const rows = await this.readMatrix(dir)
    const plan: StageAction[] = []

    for (const row of rows) {
      if (row.stage === 0 && row.workdir === 0) continue
      if (await git.isIgnored({ fs: nodeFs, dir, filepath: row.filepath })) continue

      if (row.workdir === 0) {
        // 工作区已删除：需要从索引移除
        if (row.stage !== 0) plan.push({ filepath: row.filepath, action: 'remove' })
        continue
      }

      if (row.head !== row.workdir || row.head !== row.stage) {
        plan.push({ filepath: row.filepath, action: 'add' })
      }
    }

    return plan
  }
}

/** 未保存令牌时不注入 onAuth，交由服务端返回明确的认证错误 */
function onAuthFor(auth: OptionalAuth): (() => GitAuth) | undefined {
  if (!auth) return undefined
  return () => ({ username: auth.username, password: auth.password })
}

/**
 * 三元组全相等即为「与 HEAD 一致」：HEAD / 工作区 / 暂存区都处在同一状态。
 * [1,1,1] 是没动过的文件，[0,0,0] 是三者皆无 —— 都不该出现在变更列表里。
 */
function isUnchanged(row: MatrixRow): boolean {
  return row.head === row.workdir && row.workdir === row.stage
}

function kindOf(row: MatrixRow): ChangedFile['kind'] {
  if (row.workdir === 0) return 'deleted'
  if (row.head === 0) return 'added'
  return 'modified'
}

async function tryResolveRef(dir: string, ref: string): Promise<string | null> {
  return git.resolveRef({ fs: nodeFs, dir, ref }).catch(() => null)
}

function isMissingRemoteBranch(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? ''
  const name = (error as { name?: string }).name ?? ''
  return code === 'RemoteBranchNotFoundError' || name === 'RemoteBranchNotFoundError'
}
