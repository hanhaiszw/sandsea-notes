import type { EditorView } from '@codemirror/view'

import {
  IMAGE_EXTENSION_BY_MIME,
  extname,
  isImageExtension,
  parentOf,
  relativePosixPath
} from '@shared/notes'

/**
 * 粘贴 / 拖拽图片 → 落盘到笔记库根目录的 images/ → 在光标处插入引用。
 *
 * 与 format.ts 里的排版动作分开：那些都是同步 dispatch，
 * 而这里要先等主进程写盘，天然是异步的。
 */

/** 由 File 推断图片扩展名；不是受支持的图片时返回 null */
export function imageExtensionOf(file: File): string | null {
  const byMime = IMAGE_EXTENSION_BY_MIME[file.type.toLowerCase()]
  if (byMime) return byMime

  // 从系统文件管理器拖进来的文件可能没有 MIME，退回到后缀名判断
  const byExtension = extname(file.name).replace(/^\./, '')
  return isImageExtension(byExtension) ? byExtension : null
}

/** 挑出拖入项里的图片文件；没有图片时应当让事件按默认行为继续走 */
export function pickImageFiles(list: FileList | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((file) => imageExtensionOf(file) !== null)
}

export interface InsertRange {
  from: number
  to: number
}

/**
 * 依次落盘并插入引用；返回第一个失败原因，全部成功时返回 null。
 *
 * 插入位置取自按下粘贴 / 松手拖放的那一刻；等待写盘期间文档可能已经变化，
 * 因此真正 dispatch 时把位置夹回文档范围内，避免越界抛错。
 */
export async function insertImages(
  view: EditorView,
  files: File[],
  notePath: string,
  range: InsertRange
): Promise<string | null> {
  const references: string[] = []
  const noteDir = parentOf(notePath)

  for (const file of files) {
    const extension = imageExtensionOf(file)
    if (!extension) continue

    const data = new Uint8Array(await file.arrayBuffer())
    const saved = await window.notes.asset.saveImage({ data, extension })
    if (!saved.ok) return saved.error

    references.push(imageReference(file, noteDir, saved.data.path))
  }

  if (references.length === 0) return null

  const markdown = references.join('\n')
  const length = view.state.doc.length
  const from = Math.min(range.from, length)
  const to = Math.min(range.to, length)

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length }
  })
  view.focus()

  return null
}

/** 生成 `![原始文件名](从笔记到图片的相对路径)` */
function imageReference(file: File, noteDir: string, imagePath: string): string {
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, ' ').trim() || '图片'
  return `![${alt}](${relativePosixPath(noteDir, imagePath)})`
}
