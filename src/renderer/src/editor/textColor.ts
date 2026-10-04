import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 给选区上色 / 去掉颜色。
 *
 * 语法与渲染见 markdown/colorSpan.ts。这一侧只负责算出该改哪一段源码。
 */

/** 预设色：刻意都取中等明度，白天与黑夜两种底色上都看得清 */
export const TEXT_COLORS = [
  '#c2635a', // 红
  '#c98a3f', // 橙
  '#a8862c', // 黄
  '#5f8f5b', // 绿
  '#4a8f8b', // 青
  '#5a7fb8', // 蓝
  '#8a6bb0', // 紫
  '#b8668f' // 粉
] as const

/** 没有选中文字时插入的占位内容 */
const PLACEHOLDER = '文字'

/** 文档里的颜色标记；与渲染侧的语法保持一致 */
const COLOR_SPAN = /\[([^\]\n]*)\]\{color=([^}\n]*)\}/g

interface ColorSpan {
  /** 整个标记 `[文字]{color=x}` 的范围 */
  from: number
  to: number
  /** 方括号里的原文，用于去掉颜色时还原 */
  text: string
  /** 颜色值自身的范围，替换颜色时只改这一段 */
  colorFrom: number
  colorTo: number
}

/**
 * 找出完全包住选区的颜色标记。
 *
 * 有它才能做到「对已经上过色的文字再点一次颜色是换色，而不是又套一层」。
 * 选区落在哪个标记内部就返回哪个；跨多个标记时不处理，交给调用方新套一层。
 */
function findColorSpan(doc: string, from: number, to: number): ColorSpan | null {
  COLOR_SPAN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = COLOR_SPAN.exec(doc)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (start > from || end < to) continue

    // `[` + 正文 + `]` + `{color=` 之后才是颜色值
    const colorFrom = start + 1 + match[1].length + 1 + '{color='.length

    return {
      from: start,
      to: end,
      text: match[1],
      colorFrom,
      colorTo: colorFrom + match[2].length
    }
  }

  return null
}

/**
 * 把范围扩展到不切开任何颜色标记。
 *
 * 选区从标记中间穿过时（比如从彩色词拖到下一个彩色词的属性里），
 * 直接替换会在源码里留下半截 `{color=`，渲染出来是坏的。
 */
function expandToWholeSpans(doc: string, from: number, to: number): { from: number; to: number } {
  COLOR_SPAN.lastIndex = 0

  let start = from
  let end = to

  let match: RegExpExecArray | null
  while ((match = COLOR_SPAN.exec(doc)) !== null) {
    const spanStart = match.index
    const spanEnd = spanStart + match[0].length

    // 与选区相交就整个纳入；用扩展后的 start / end 继续比对后面的标记
    if (spanStart < end && spanEnd > start) {
      start = Math.min(start, spanStart)
      end = Math.max(end, spanEnd)
    }
  }

  return { from: start, to: end }
}

export function applyTextColor(view: EditorView, color: string): void {
  const { from, to } = view.state.selection.main
  const doc = view.state.doc.toString()
  const span = findColorSpan(doc, from, to)

  // 选中的是已经上过色的文字：只换颜色值，不重新套一层
  if (span) {
    view.dispatch({
      changes: { from: span.colorFrom, to: span.colorTo, insert: color },
      userEvent: 'input'
    })
    view.focus()
    return
  }

  const range = expandToWholeSpans(doc, from, to)
  // 选区内已经带着颜色标记时先把它们拆掉：否则会在方括号里再套一层方括号，
  // 那种写法两侧的解析器都认不出来。语义上也更合理 —— 整段都改成新颜色。
  const stripped = doc.slice(range.from, range.to).replace(COLOR_SPAN, '$1')
  const text = stripped === '' ? PLACEHOLDER : stripped
  const insert = `[${text}]{color=${color}}`

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    // 保持选中方括号里的文字：这样连点几种颜色是来回换色，而不是层层嵌套，
    // 没选中文字时也直接输入就能替换占位内容
    selection: EditorSelection.range(range.from + 1, range.from + 1 + text.length),
    userEvent: 'input'
  })
  view.focus()
}

/** 去掉选区所在的颜色标记；选区不在任何标记里时不动文档 */
export function clearTextColor(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const doc = view.state.doc.toString()
  const span = findColorSpan(doc, from, to)
  if (!span) return

  view.dispatch({
    changes: { from: span.from, to: span.to, insert: span.text },
    userEvent: 'input'
  })
  view.focus()
}
