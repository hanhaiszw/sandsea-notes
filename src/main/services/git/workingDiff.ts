import { promises as fsp } from 'node:fs'
import path from 'node:path'

import { skippedDiff, type FileDiff } from '@shared/git'

import { MAX_DIFF_BYTES, buildFileDiff } from './diff'

/**
 * 「工作区相对 HEAD」的行级差异，也就是还没提交的那份改动。
 *
 * 两份内容的来源不同：HEAD 那份只有各后端自己拿得到（内置实现读 blob，
 * 系统 git 用 show），工作区那份都是从磁盘读 —— 所以读盘、体积判定与
 * 差异组装放在这里，两个后端各传一个 before 进来就行。
 */
export async function workingDiffFrom(
  dir: string,
  filePath: string,
  before: string | null
): Promise<FileDiff> {
  const absolute = path.join(dir, filePath)
  const stat = await fsp.stat(absolute).catch(() => null)
  const isFile = stat?.isFile() ?? false

  // 太大就别读了：读进来也会被判定为二进制，白占内存
  if (isFile && stat !== null && stat.size > MAX_DIFF_BYTES) return skippedDiff(filePath)

  // 文件被删掉时 after 为空，差异自然表现为「整份删除」
  const after = isFile ? await fsp.readFile(absolute, 'utf8') : null
  return buildFileDiff(filePath, before ?? '', after ?? '')
}
