import type { EditorView } from '@codemirror/view'

/**
 * 分栏模式的同步滚动。
 *
 * 这里没有用「两边滚动百分比对齐」那种最省事的做法：编辑器是等宽等行高的，
 * 预览里却有图片、表格、图表，两边内容的总高度差得很远。文档里只要有一张
 * 大图或一段长代码，按比例映射到后半段就会明显错位，而且越滚越偏。
 *
 * 所以基准取的是**源码行号**：渲染时给预览的每个顶层块打上 data-line
 * （见 markdown/pipeline.ts），由此得到「源码行 ↔ 预览纵向位置」的对照表。
 * 两个方向都先换算成源码行，再落到对方的坐标里。
 *
 * 对齐的是两边的**视口中心**，不是顶边。原因：同一个源码行区间，两边占的高度
 * 不成比例（预览里一张图就顶编辑器几十行），按顶边对齐时误差全部堆在视口下端，
 * 滚到底会整整差出一屏 —— 实测 65 行的笔记，编辑器滑到底时预览只到 58%。
 * 用中心对齐则把这点误差摊到两头，再配合下方「末尾哨兵」的夹取，
 * 两端都能刚好贴边。
 */

/** 预览里的锚点：源码行号（1 基）与该块在预览滚动内容中的纵向位置 */
interface Anchor {
  line: number
  top: number
}

/**
 * 程序化滚动之后，多久之内忽略对方冒出来的 scroll 事件（毫秒）。
 *
 * 不做这个的话两边会互相触发，滚动条抖个不停。scroll 事件是异步派发的，
 * 所以设完 scrollTop 立刻打时间戳，对方那个事件一定会落在窗口里被丢掉。
 */
const EVENT_LOCK_MS = 80

/**
 * 量出预览里的全部锚点。
 *
 * 每次同步都重新量，不做缓存：缓存要处理「内容变了 / 图片加载完 / 窗口缩放」
 * 三类失效，漏一个就是错位的 bug；而量一遍只是几十次布局读取，
 * 浏览器的布局结果本身有缓存，代价可以接受。
 */
function collectAnchors(preview: HTMLElement, totalLines: number): Anchor[] {
  const base = preview.getBoundingClientRect().top - preview.scrollTop
  const anchors: Anchor[] = []

  for (const node of preview.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(node.dataset.line)
    if (!Number.isFinite(line) || line <= 0) continue
    anchors.push({ line, top: node.getBoundingClientRect().top - base })
  }

  anchors.sort((left, right) => left.line - right.line)

  // 两端补哨兵，让编辑器滚到顶 / 滚到底时预览也刚好贴边。
  // 少了它们，末尾的累计误差会在后半段放大成肉眼可见的错位。
  //
  // 末尾哨兵的 top 必须**不小于**最后一个真实锚点：末尾是个很高的块时
  // （长图、大图表），它的顶部（比如 1887）已经在可滚动上限（比如 1548）之下，
  // 这时直接拿 maxScroll 当哨兵，top 序列就倒挂了。查表靠「第一个不小于目标的
  // 锚点」来定段，倒挂会让尾部整段落到错误的区间里。
  const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight)
  const lastTop = anchors[anchors.length - 1]?.top ?? 0
  const tailTop = Math.max(maxScroll, lastTop)

  return [{ line: 0, top: 0 }, ...anchors, { line: totalLines + 1, top: tailTop }]
}

/** 源码行 → 预览纵向位置 */
function lineToTop(anchors: Anchor[], line: number): number {
  const last = anchors[anchors.length - 1]
  if (line <= 0) return 0
  if (line >= last.line) return last.top

  for (let index = 1; index < anchors.length; index += 1) {
    const before = anchors[index - 1]
    const after = anchors[index]
    if (line > after.line) continue

    const span = after.line - before.line
    // 相邻锚点挤在同一行（很短的块）时退化为取后者，避免除以零
    if (span <= 0) return after.top
    return before.top + ((line - before.line) / span) * (after.top - before.top)
  }

  return last.top
}

/** 预览纵向位置 → 源码行 */
function topToLine(anchors: Anchor[], top: number): number {
  const last = anchors[anchors.length - 1]
  if (top <= 0) return 0
  if (top >= last.top) return last.line

  for (let index = 1; index < anchors.length; index += 1) {
    const before = anchors[index - 1]
    const after = anchors[index]
    if (top > after.top) continue

    const span = after.top - before.top
    if (span <= 0) return after.line
    return before.line + ((top - before.top) / span) * (after.line - before.line)
  }

  return last.line
}

/**
 * CodeMirror 文档坐标 → 屏幕坐标的平移量。
 *
 * block.top 是相对文档顶端的，documentTop 是文档顶端在屏幕上的位置，
 * 两者相减就是换算用的原点。这样写不用去猜「文档原点在内容内边距之上还是之下」，
 * 以后调整 .cm-content 的 padding 也不会失效。
 */
function screenOrigin(view: EditorView): number {
  return view.documentTop - view.lineBlockAt(0).top
}

interface ScrollSyncTarget {
  view: EditorView
  /** 预览的滚动容器（.preview） */
  preview: HTMLElement
}

/**
 * 接上两边的滚动同步，返回解绑函数。
 *
 * 只在用户滚动时才同步，挂载时不强行对齐：编辑器与预览各有各的滚动位置，
 * 静默跳到另一边的位置反而会打断阅读。
 */
export function attachScrollSync({ view, preview }: ScrollSyncTarget): () => void {
  const scroller = view.scrollDOM
  let editorLock = 0
  let previewLock = 0

  const syncPreviewFromEditor = (): void => {
    const origin = screenOrigin(view)
    const viewport = scroller.clientHeight
    const docY = scroller.getBoundingClientRect().top - origin + viewport / 2
    const block = view.lineBlockAtHeight(Math.max(0, docY))
    const line = view.state.doc.lineAt(block.from)
    const fraction = block.height > 0 ? (docY - block.top) / block.height : 0

    const target = lineToTop(
      collectAnchors(preview, view.state.doc.lines),
      line.number + Math.min(Math.max(fraction, 0), 1)
    )

    previewLock = performance.now() + EVENT_LOCK_MS
    // 落点也按中心算；算出来超出预览的可滚动范围时浏览器自己会夹住，正好贴边
    preview.scrollTop = target - viewport / 2
  }

  const syncEditorFromPreview = (): void => {
    const total = view.state.doc.lines
    const viewport = scroller.clientHeight
    const line = topToLine(
      collectAnchors(preview, total),
      preview.scrollTop + preview.clientHeight / 2
    )

    // 光标位置到不了的地方仍要落在一个真实行上，越界一律夹回文档范围
    const clamped = Math.min(Math.max(line, 1), total)
    const number = Math.floor(clamped)
    const docLine = view.state.doc.line(number)
    const block = view.lineBlockAt(docLine.from)
    const docY = block.top + (clamped - number) * block.height

    editorLock = performance.now() + EVENT_LOCK_MS
    scroller.scrollTop +=
      screenOrigin(view) + docY - scroller.getBoundingClientRect().top - viewport / 2
  }

  const onEditorScroll = (): void => {
    if (performance.now() < editorLock) return
    syncPreviewFromEditor()
  }

  const onPreviewScroll = (): void => {
    if (performance.now() < previewLock) return
    syncEditorFromPreview()
  }

  scroller.addEventListener('scroll', onEditorScroll, { passive: true })
  preview.addEventListener('scroll', onPreviewScroll, { passive: true })

  return () => {
    scroller.removeEventListener('scroll', onEditorScroll)
    preview.removeEventListener('scroll', onPreviewScroll)
  }
}
