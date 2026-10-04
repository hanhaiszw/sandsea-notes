import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'

import { normalizeImageTarget, resolvePosixPath } from '@shared/notes'

/**
 * 把预览里拖出来的宽度写回源码。
 *
 * 难点在于「预览里的这张图」要对应到「源码里的那一段」。做法是双重校验：
 * 序号说明它是文档里的第几张图，路径用来确认那一处确实引用了同一张图。
 * 加了路径校验是因为语法树可能落后于文档 —— CodeMirror 对长文档是增量、
 * 按视口解析的，光看序号有改错地方的风险。
 */

export interface ImageResizeTarget {
  /** 图片在文档里的出现序号 */
  index: number
  /** 图片在笔记库内的目标路径（已解码），用于校验定位到的确实是同一张 */
  path: string
  /** 当前笔记所在目录，用于把源码里的地址解析成同样的形式 */
  baseDir: string
  /** 拖拽后的宽度（像素） */
  width: number
}

/** 图片节点在文档中的位置，以及它引用的地址 */
interface ImageNode {
  from: number
  to: number
  destination: string | null
}

/** 按文档顺序取出所有图片节点 */
function imageNodes(view: EditorView): ImageNode[] {
  const doc = view.state.doc
  const nodes: ImageNode[] = []

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'Image') return

      // 引用式图片（![a][ref]）没有 URL 子节点，此时 destination 为 null，
      // 也就无法校验，调用方会放弃这次改写
      let destination: string | null = null
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'URL') destination = doc.sliceString(cursor.from, cursor.to)
        } while (cursor.nextSibling())
      }

      nodes.push({ from: node.from, to: node.to, destination })
    }
  })

  return nodes
}

/**
 * 给图片写入 `{width=N}`；定位不可靠时返回 false 且不改动文档。
 */
export function applyImageWidth(view: EditorView, target: ImageResizeTarget): boolean {
  const node = imageNodes(view)[target.index]
  if (!node || node.destination === null) return false

  const resolved = resolvePosixPath(target.baseDir, normalizeImageTarget(node.destination))
  if (resolved !== target.path) return false

  const doc = view.state.doc
  // 属性块紧跟在图片语法之后，可能隔着一个空格
  const after = doc.sliceString(node.to, Math.min(node.to + 200, doc.length))
  const existing = /^[ \t]*\{([^}\n]*)\}/.exec(after)
  const attributes = existing ? mergeWidth(existing[1], target.width) : `width=${target.width}`

  view.dispatch({
    changes: {
      from: node.to,
      to: node.to + (existing ? existing[0].length : 0),
      insert: `{${attributes}}`
    },
    // userEvent: 让这次改动进入撤销历史，用户可以用 Cmd+Z 撤回
    userEvent: 'input'
  })

  return true
}

/** 保留其它属性，只替换 width */
function mergeWidth(attributes: string, width: number): string {
  const rest = attributes
    .split(/\s+/)
    .filter((part) => part !== '' && !/^width\s*=/.test(part))

  return [`width=${width}`, ...rest].join(' ')
}
