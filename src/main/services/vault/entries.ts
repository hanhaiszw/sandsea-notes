import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { CreateEntryInput, CreatedEntry } from '@shared/ipc'
import { checkEntryName, toPosix, type EntryKind } from '@shared/notes'

import { isInsideRoot, resolveInsideRoot } from '../paths'
import { requireVaultRoot } from './root'

/**
 * 新建笔记或文件夹。
 *
 * 名称校验放在 shared 层，主进程这里再执行一次：渲染进程可以绕过，
 * 而落盘前必须保证名字在任何平台都能安全检出。
 */
export async function createEntry(input: CreateEntryInput, kind: EntryKind): Promise<CreatedEntry> {
  const root = requireVaultRoot()

  const checked = checkEntryName(input.name, kind)
  if (!checked.ok) throw new Error(checked.message)

  const parentAbs = input.parentPath ? await resolveInsideRoot(root, input.parentPath) : root
  const parentStat = await fs.stat(parentAbs).catch(() => null)
  if (!parentStat || !parentStat.isDirectory()) {
    throw new Error('目标文件夹不存在或不是文件夹')
  }

  const targetAbs = path.join(parentAbs, checked.finalName)
  // 名称已不含路径分隔符，这里再校验一次拼接结果，确保仍在笔记库范围内
  if (!isInsideRoot(root, targetAbs)) {
    throw new Error('非法路径：超出笔记库范围')
  }

  try {
    if (kind === 'folder') {
      await fs.mkdir(targetAbs)
    } else {
      // 'wx'：目标已存在时直接失败，绝不覆盖用户已有内容
      await fs.writeFile(targetAbs, '', { encoding: 'utf8', flag: 'wx' })
    }
  } catch (error) {
    throw new Error(describeCreateError(error, kind))
  }

  return { path: toPosix(path.relative(root, targetAbs)) }
}

function describeCreateError(error: unknown, kind: EntryKind): string {
  const code = (error as NodeJS.ErrnoException).code
  const what = kind === 'folder' ? '文件夹' : '文件'

  if (code === 'EEXIST') return `已存在同名${what}`
  if (code === 'ENAMETOOLONG') return '名称过长，请缩短后重试'
  if (code === 'ENOSPC') return '磁盘空间不足'

  // EPERM 在 macOS 上通常来自系统的文件夹访问授权（TCC），而不是 Unix 权限位。
  // 两者的排查方向完全不同，所以分开提示。
  if (code === 'EPERM') {
    return `系统拒绝了写入。若笔记库位于桌面 / 文稿 / 下载目录，请在「系统设置 → 隐私与安全性 → 文件与文件夹」中允许本应用访问对应目录，然后重启应用`
  }

  if (code === 'EACCES') return `没有权限在该位置创建${what}，请检查该目录的权限`

  return error instanceof Error ? error.message : String(error)
}
