import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { FileContent, FileWriteResult } from '@shared/ipc'
import { MAX_NOTE_BYTES, isNoteFile, toPosix } from '@shared/notes'

import { resolveInsideRoot } from '../paths'
import { requireVaultRoot } from './root'

/** 读取一篇笔记的文本内容 */
export async function readNoteFile(relPath: string): Promise<FileContent> {
  const root = requireVaultRoot()
  const absolute = await resolveInsideRoot(root, relPath)

  if (!isNoteFile(path.basename(absolute))) {
    throw new Error('该文件是资源文件，内容预览将在后续里程碑接入')
  }

  // 走文件句柄读：先 stat 再 readFile 之间存在被换成大文件的机会，
  // 同一个句柄能保证「判断大小」与「读到的内容」说的是同一个文件
  const handle = await fs.open(absolute, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size > MAX_NOTE_BYTES) {
      throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），已拒绝载入`)
    }

    return {
      path: toPosix(relPath),
      content: await handle.readFile('utf8'),
      mtimeMs: stat.mtimeMs
    }
  } finally {
    await handle.close()
  }
}

/**
 * 写回笔记内容。
 *
 * 两个安全要点：
 * 1. baseMtimeMs 与磁盘现状不符时拒绝写入 —— 文件在编辑期间被外部改过，
 *    静默覆盖会直接丢掉那边的改动；
 * 2. 原子写入（临时文件 + rename），避免写到一半崩溃把文件截断。
 */
export async function writeNoteFile(
  relPath: string,
  content: string,
  baseMtimeMs: number | null
): Promise<FileWriteResult> {
  const root = requireVaultRoot()
  const absolute = await resolveInsideRoot(root, relPath)

  if (!isNoteFile(path.basename(absolute))) {
    throw new Error('只能写入 Markdown 笔记文件')
  }

  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('文件已不存在，可能已被外部删除')

  if (baseMtimeMs !== null && Math.abs(stat.mtimeMs - baseMtimeMs) > 1) {
    throw new Error('文件已被外部修改，为避免覆盖对方的改动，本次保存已取消')
  }

  const normalized = await preserveNewlineStyle(absolute, content)

  // 读取有大小上限，写入必须对称：否则渲染层能塞进一个之后自己都打不开的文件
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (bytes > MAX_NOTE_BYTES) {
    const limit = MAX_NOTE_BYTES / 1024 / 1024
    throw new Error(`内容过大（${(bytes / 1024 / 1024).toFixed(1)} MB），超过 ${limit} MB 上限，未保存`)
  }

  // 临时名必须唯一：同一进程内两次并发写同一个文件时，固定名字会互相覆盖
  const temp = `${absolute}.notes-tmp-${randomUUID()}`
  await fs.writeFile(temp, normalized, 'utf8')

  try {
    await fs.rename(temp, absolute)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }

  const next = await fs.stat(absolute)
  return { mtimeMs: next.mtimeMs }
}

/** 沿用文件原有换行风格，避免整个文件被改写导致 Git diff 满屏 */
async function preserveNewlineStyle(absolute: string, content: string): Promise<string> {
  const existing = await fs.readFile(absolute, 'utf8').catch(() => '')
  if (!existing.includes('\r\n')) return content
  return content.replace(/\r?\n/g, '\r\n')
}
