import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  ALLOWED_EXTENSIONS,
  extname,
  toPosix,
  type FileDir,
  type FileNode
} from '@shared/notes'

import { config } from '../config'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** 扫描整个笔记库，返回按「目录在前、同类按名称」排好序的文件树 */
export async function scanTree(root: string): Promise<FileNode[]> {
  // 忽略名单只取一次：原先每个目录都要重建一遍 Set，深目录下是纯浪费
  return scanDirectory(root, root, new Set(config.get('ignoredDirNames')))
}

async function scanDirectory(
  dir: string,
  root: string,
  ignored: ReadonlySet<string>
): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    // 跳过软链，避免循环引用与越出笔记库
    if (entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.') || ignored.has(entry.name)) continue

    const absolute = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      const node: FileDir = {
        name: entry.name,
        path: toPosix(path.relative(root, absolute)),
        type: 'directory',
        children: await scanDirectory(absolute, root, ignored)
      }
      nodes.push(node)
      continue
    }

    if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name))) {
      nodes.push({
        name: entry.name,
        path: toPosix(path.relative(root, absolute)),
        type: 'file'
      })
    }
  }

  return nodes.sort(compareNodes)
}

/** 目录在前，同类按名称排序 */
function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return collator.compare(a.name, b.name)
}
