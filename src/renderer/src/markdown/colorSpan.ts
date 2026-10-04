import type MarkdownIt from 'markdown-it'

/**
 * 文字颜色的 Markdown 语法：`[文字]{color=#c2635a}`。
 *
 * 为什么不写成 `<span style="color:...">`：那需要把 markdown-it 的
 * 原始 HTML 透传打开（`html: true`），粘贴外部内容时就多了一条 XSS 攻击面。
 * 花括号属性与图片的 `{width=320}` 是同一套写法，也不需要放开 HTML。
 */

/** 十六进制色值 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** 允许的颜色名。只做白名单：颜色值最终会进 style 属性，不能放任意字符串 */
const NAMED_COLORS = new Set([
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'gray',
  'grey',
  'black',
  'white'
])

/** 取色器给出的值与手写的属性都要过这一关；不认识就返回 null */
export function normalizeTextColor(raw: string): string | null {
  const value = raw.trim()
  if (HEX_COLOR.test(value)) return value.toLowerCase()

  const lower = value.toLowerCase()
  return NAMED_COLORS.has(lower) ? lower : null
}

/** 紧跟在 `]` 之后的属性块 */
const COLOR_ATTRIBUTE = /^\{color\s*=\s*([^}\s]+)\}/

/**
 * 把 `[文字]{color=...}` 渲染成带颜色的 span。
 *
 * 用行内规则而不是 core ruler：core ruler 里没有 `state.push`，
 * 造不出新 token；行内规则恰好是在 `[` 处被调用，与 markdown-it 自己的
 * link 规则同一个位置，写法可以直接照搬。
 */
export function colorSpanPlugin(instance: InstanceType<typeof MarkdownIt>): void {
  instance.inline.ruler.before('link', 'text-color', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false

    const max = state.posMax
    const labelStart = state.pos + 1
    const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos, true)
    if (labelEnd < 0) return false

    const attribute = COLOR_ATTRIBUTE.exec(state.src.slice(labelEnd + 1, max))
    if (!attribute) return false

    const color = normalizeTextColor(attribute[1])
    // 认不出来就交给后面的规则按普通文本处理，不去猜
    if (color === null) return false

    if (!silent) {
      // 与 link 规则同样的手法：临时把 posMax 收到 `]`，让内部的标记
      // （加粗、行内代码等）在同一个 token 流里正常解析
      state.pos = labelStart
      state.posMax = labelEnd

      state.push('text_color_open', 'span', 1).attrSet('style', `color:${color}`)
      state.md.inline.tokenize(state)
      state.push('text_color_close', 'span', -1)
    }

    state.pos = labelEnd + 1 + attribute[0].length
    state.posMax = max
    return true
  })
}
