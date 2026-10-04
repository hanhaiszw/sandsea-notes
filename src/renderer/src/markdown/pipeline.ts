import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'

import { assetUrl, normalizeImageTarget, resolvePosixPath } from '@shared/notes'

import { colorSpanPlugin } from './colorSpan'

/**
 * Markdown 渲染管线（方案 §5.2）。
 *
 * html: false 是关键安全设置：源码里的原始 HTML 一律按文本转义输出，
 * 因此渲染结果只会包含 markdown-it 自己生成的结构。
 * 尚未接入：KaTeX 公式、Shiki 代码高亮。
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
})
  // enabled: 预览里的复选框要能直接点 —— 默认渲染成 disabled，点了没有任何反应
  .use(taskLists, { enabled: true })
  .use(footnote)
  .use(colorSpanPlugin)
  .use(stampSourceLines)
  .use(stampTaskLines)
  .use(tableInteractions)
  .use(vaultImagePlugin)

/** 带协议前缀的地址（http:、data:、已完成换算的 notes-asset:）都不该被改写 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** 紧跟在图片之后的属性块，形如 `{width=320}` */
const ATTRIBUTE_BLOCK = /^[ \t]*\{([^}\n]*)\}/

/** 属性块里认得的两个数字属性；认不出来就把 `{...}` 当普通文本留着 */
const NUMBER_ATTRIBUTES = {
  width: /(?:^|\s)width\s*=\s*"?([0-9]+)"?/,
  height: /(?:^|\s)height\s*=\s*"?([0-9]+)"?/
} as const

const NO_ATTRIBUTES = { width: null, height: null }

interface ImageAttributes {
  width: number | null
  height: number | null
}

/**
 * 把 markdown 里的图片地址解析成笔记库内的路径。
 *
 * 相对路径按笔记所在目录解析 —— 与 Markdown 的惯例一致，
 * 这样笔记连同子目录一起搬走时，`../images/x.png` 这类写法依然成立。
 * 外部地址（http:、data:）与越出笔记库的路径返回 null，表示不该改写。
 */
function resolveImageTarget(source: string, baseDir: string): string | null {
  const value = normalizeImageTarget(source).replace(/\\/g, '/')

  if (value === '' || HAS_SCHEME.test(value) || value.startsWith('//')) return null

  // 以 / 开头视为相对笔记库根目录
  return resolvePosixPath(value.startsWith('/') ? '' : baseDir, value)
}

/**
 * 解析图片后面紧跟的 `{width=320}`，并从正文里摘掉它。
 *
 * 摘掉这一步必须做：否则花括号会原样渲染成可见文字。
 * 但只有认得出的属性才摘，避免把正文里正常的花括号吃掉。
 */
function takeImageAttributes(children: Token[], imagePosition: number): ImageAttributes {
  const following = children[imagePosition + 1]
  if (!following || following.type !== 'text') return NO_ATTRIBUTES

  const block = ATTRIBUTE_BLOCK.exec(following.content)
  if (!block) return NO_ATTRIBUTES

  const width = readNumberAttribute(block[1], NUMBER_ATTRIBUTES.width)
  const height = readNumberAttribute(block[1], NUMBER_ATTRIBUTES.height)
  if (width === null && height === null) return NO_ATTRIBUTES

  following.content = following.content.slice(block[0].length)
  // 属性块是这段文本的全部内容时整个删掉，免得留下一个空文本节点
  if (following.content === '') children.splice(imagePosition + 1, 1)

  return { width, height }
}

function readNumberAttribute(attributes: string, pattern: RegExp): number | null {
  const match = pattern.exec(attributes)
  return match ? Number(match[1]) : null
}

/**
 * 能当滚动锚点的顶层块。
 *
 * 只挑渲染时会把 token 上的属性带出去的块，并且只标顶层 ——
 * 引用里的段落、列表项这些嵌套块如果也标，同一段区域会堆好几个锚点，
 * 插值出来的位置反而更抖。
 */
const ANCHOR_BLOCKS = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'table_open',
  'fence',
  'code_block'
])

/**
 * 给顶层块打上源码起始行号（1 基），供分栏同步滚动定位（见 editor/scrollSync.ts）。
 *
 * 只改 token 属性，渲染仍交给 markdown-it 自己的规则，
 * 因此不需要替换任何 renderer，也就不会漏掉转义、高亮这些细节。
 */
function stampSourceLines(instance: InstanceType<typeof MarkdownIt>): void {
  instance.core.ruler.push('source-lines', (state) => {
    for (const token of state.tokens) {
      if (token.level !== 0 || !token.map || !ANCHOR_BLOCKS.has(token.type)) continue
      token.attrSet('data-line', String(token.map[0] + 1))
    }
  })
}

/**
 * 给任务列表项标上源码行号，预览里点复选框时靠它翻回源码那一行。
 *
 * 必须排在 markdown-it-task-lists 之后：任务项是那个插件打了
 * class="task-list-item" 才认得出来，而它同时已经把复选框换成了 html_inline。
 * 行号落在 list_item_open 上 —— 那个 token 带着 map，且它的属性会被渲染成 <li> 的属性。
 */
function stampTaskLines(instance: InstanceType<typeof MarkdownIt>): void {
  instance.core.ruler.after('github-task-lists', 'task-source-lines', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'list_item_open' || !token.map) continue

      const className = token.attrGet('class')
      if (typeof className !== 'string') continue
      if (!className.split(/\s+/).includes('task-list-item')) continue

      token.attrSet('data-task-line', String(token.map[0] + 1))
    }
  })
}

/**
 * 表格的交互标记。
 *
 * 1. 单元格开 contenteditable：预览里点进去就能改内容（见 components/Preview.tsx）
 * 2. 表上补一个 data-line-end：增删列要改表格占用的**每一行**，光有起始行不够
 *
 * 单元格的行列下标不在这里标 —— DOM 的 rowIndex / cellIndex 本来就准，
 * 再往源码里算一遍反而多一处可能对不上的地方。
 */
function tableInteractions(instance: InstanceType<typeof MarkdownIt>): void {
  instance.core.ruler.push('table-interactions', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'td_open' || token.type === 'th_open') {
        token.attrSet('contenteditable', 'true')
        // 中文笔记里红波浪线基本是噪音，而且单元格本来也不是给拼写检查用的
        token.attrSet('spellcheck', 'false')
        continue
      }

      if (token.type !== 'table_open' || !token.map) continue
      token.attrSet('data-line-end', String(token.map[1]))
    }
  })
}

/**
 * 图片处理：解析尺寸属性、把地址换算成预览可用的协议地址，
 * 并把「第几张」与「目标路径」交给预览 —— 拖拽改宽度时要靠它们定位回源码。
 *
 * 放在 core ruler 而不是 renderer.rules.image：只改 token 的属性能复用
 * markdown-it 自己的 image 渲染（alt、title、转义都交给它），
 * 自己重写渲染规则反而容易漏掉细节。
 *
 * 用 InstanceType 取实例类型：这个包的默认导出是 const（构造器值），
 * 没有同名类型可直接标注。
 */
function vaultImagePlugin(instance: InstanceType<typeof MarkdownIt>): void {
  instance.core.ruler.push('vault-images', (state) => {
    const baseDir = typeof state.env.baseDir === 'string' ? state.env.baseDir : ''
    let index = 0

    for (const token of state.tokens) {
      const children = token.children
      if (!children) continue

      for (let position = 0; position < children.length; position += 1) {
        const child = children[position]
        if (child.type !== 'image') continue

        const attributes = takeImageAttributes(children, position)
        const src = child.attrGet('src')
        const target = typeof src === 'string' ? resolveImageTarget(src, baseDir) : null

        if (target !== null) {
          child.attrSet('src', assetUrl(target))
          child.attrSet('data-img-path', target)
        }
        if (attributes.width !== null) child.attrSet('width', String(attributes.width))
        if (attributes.height !== null) child.attrSet('height', String(attributes.height))

        // 序号按「文档里所有图片」计数，与编辑器语法树里的顺序一一对应；
        // 解析不出路径的图片也要计数，否则后面的图片序号会整体错位
        child.attrSet('data-img-index', String(index))
        index += 1
      }
    }
  })

  wrapImagesInFrame(instance)
}

/**
 * 给图片套一层容器。
 *
 * 拖拽手柄需要一个能定位的父元素，而 <img> 不能有子节点，
 * 所以只能在渲染层多包一个 <span>。
 */
function wrapImagesInFrame(instance: InstanceType<typeof MarkdownIt>): void {
  const renderImage = instance.renderer.rules.image

  instance.renderer.rules.image = (tokens, idx, options, env, self) => {
    const image = renderImage
      ? renderImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)

    return `<span class="image-frame">${image}<span class="image-handle" aria-hidden="true"></span></span>`
  }
}

export type MarkdownSegment =
  | { kind: 'html'; key: string; html: string }
  /** line 是这段代码块在源码里的起始行（1 基），分栏同步滚动拿它当锚点 */
  | { kind: 'mermaid'; key: string; code: string; line: number }

/** 稳定但能区分重复内容的 key，避免无关编辑导致图表被重建 */
function segmentKey(code: string, seen: Map<string, number>): string {
  let hash = 0
  for (let index = 0; index < code.length; index += 1) {
    hash = (hash * 31 + code.charCodeAt(index)) | 0
  }
  const base = `mermaid-${(hash >>> 0).toString(36)}`
  const occurrence = seen.get(base) ?? 0
  seen.set(base, occurrence + 1)
  return `${base}-${occurrence}`
}

/**
 * 把源码切成「HTML 片段 + Mermaid 片段」。
 *
 * 为什么不整篇渲染后再处理：预览每次重渲染都会重建 DOM，
 * 整篇处理会让所有图表跟着重跑 Mermaid（解析 + 布局，代价不小）。
 * 切成片段交给各自的 React 组件后，图表只在源码变化时重绘。
 *
 * baseDir 是当前笔记所在目录（笔记库内的 POSIX 相对路径），
 * 文档里的相对图片地址以它为基准解析。
 */
export function renderMarkdown(source: string, baseDir = ''): MarkdownSegment[] {
  const env: Record<string, unknown> = { baseDir }
  const tokens = md.parse(source, env)
  const segments: MarkdownSegment[] = []
  const seen = new Map<string, number>()
  let buffer: Token[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    segments.push({
      kind: 'html',
      key: `html-${segments.length}`,
      html: md.renderer.render(buffer, md.options, env)
    })
    buffer = []
  }

  for (const token of tokens) {
    // 只切分顶层代码块：嵌在列表项里的 mermaid 块如果被拎出来会打乱文档顺序，
    // 那种情况让它按普通代码块显示
    const isTopLevelMermaid =
      token.type === 'fence' && token.level === 0 && token.info.trim().toLowerCase() === 'mermaid'

    if (isTopLevelMermaid) {
      flush()
      segments.push({
        kind: 'mermaid',
        key: segmentKey(token.content, seen),
        code: token.content,
        line: (token.map?.[0] ?? 0) + 1
      })
      continue
    }
    buffer.push(token)
  }

  flush()
  return segments
}
