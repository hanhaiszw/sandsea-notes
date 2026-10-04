/**
 * 预览里表格单元格的定位与光标工具。
 *
 * 这里全是只跟 DOM 打交道的纯函数，不依赖任何组件状态 ——
 * 预览组件本身已经很重，能拿出来的先拿出来。
 */

/** 表格里的一格，以及它在源码里的位置 */
export interface CellSpot {
  cell: HTMLTableCellElement
  /** 表格表头所在的行号，1 基 */
  line: number
  /** 表格占用的最后一行，1 基 */
  lineEnd: number
  /** DOM 行序，0 是表头 */
  row: number
  /** DOM 列序，0 是第一列 */
  col: number
}

/** 写回后要补回的光标位置 */
export interface CaretSpot {
  /** 表格表头所在的行号，1 基；重渲染后靠它把格子找回来 */
  line: number
  row: number
  col: number
  /** 格内第几个字符 */
  offset: number
}

/** 键盘停手多久之后就把单元格写回源码 */
export const FLUSH_DELAY = 400

/** 方向键：在单元格之间移动时用 */
export const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** data-* 上是数字才认；读不到或不是整数一律返回 null，别让 0 混进来当有效值 */
export function readLine(element: Element | null, attribute: string): number | null {
  const raw = element?.getAttribute(attribute)
  if (raw === null || raw === undefined) return null

  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}

/**
 * 光标是不是落在这一格的第一行 / 最后一行。
 *
 * 上下键要靠它决定「换行」还是「交给浏览器逐行挪」：内容只有一行时
 * （空单元格也算）两个都是 true，一按就换行。
 */
export function caretLines(cell: HTMLElement, caret: Range): { first: boolean; last: boolean } {
  const content = document.createRange()
  content.selectNodeContents(cell)

  const lines = [...content.getClientRects()]
  if (lines.length <= 1) return { first: true, last: true }

  const box = caret.getBoundingClientRect()
  return {
    first: box.top < lines[0].bottom - 1,
    last: box.bottom > lines[lines.length - 1].top + 1
  }
}

/**
 * 光标在这一格里的字符偏移（从格首算起）；光标不在这一格里返回 null。
 *
 * 不用 `compareBoundaryPoints` 判断「是不是到头了」：光标停在文字末尾时是
 * (文本节点, 3)，而 `selectNodeContents` 得到的是 (单元格, 1)，这两个位置
 * 完全等价，但按 DOM 的比较规则是「不同的点」，判不出来。数一遍字符最稳。
 */
export function caretOffset(cell: HTMLElement, caret: Range): number | null {
  if (!cell.contains(caret.startContainer)) return null

  const before = document.createRange()
  before.selectNodeContents(cell)
  before.setEnd(caret.startContainer, caret.startOffset)
  return before.toString().length
}

/** 把光标放到某一格的第 offset 个字符处；超出内容长度就落到末尾 */
export function placeCaretAt(cell: HTMLElement, offset: number): void {
  const range = document.createRange()
  range.selectNodeContents(cell)

  let left = offset
  let placed = false
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (left <= length) {
      range.setStart(node, left)
      range.collapse(true)
      placed = true
      break
    }
    left -= length
  }
  if (!placed) range.collapse(false)

  cell.focus()
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 把光标放到某一格的开头或末尾 */
export function placeCaret(cell: HTMLElement, at: 'start' | 'end'): void {
  placeCaretAt(cell, at === 'start' ? 0 : Number.MAX_SAFE_INTEGER)
}

/** 重渲染之后按行号 + 行列下标把那一格找回来 */
export function findCell(preview: HTMLElement, spot: CaretSpot): HTMLTableCellElement | null {
  const table = preview.querySelector<HTMLTableElement>(`table[data-line="${spot.line}"]`)
  return table?.rows[spot.row]?.cells[spot.col] ?? null
}

/** 事件目标落在哪一格里；不在表格里返回 null */
export function cellAt(node: EventTarget | null): CellSpot | null {
  const cell = node instanceof HTMLElement ? node.closest<HTMLTableCellElement>('td, th') : null
  const row = cell?.closest<HTMLTableRowElement>('tr') ?? null
  const table = row?.closest('table') ?? null
  if (!cell || !row || !table) return null

  const line = readLine(table, 'data-line')
  const lineEnd = readLine(table, 'data-line-end')
  if (line === null || lineEnd === null) return null

  return { cell, line, lineEnd, row: row.rowIndex, col: cell.cellIndex }
}

/** 光标当前落在哪一格的哪个字符上；有选区或不在格子里就返回 null */
export function caretPosition(): CaretSpot | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null

  const spot = cellAt(document.activeElement)
  if (!spot) return null

  const offset = caretOffset(spot.cell, selection.getRangeAt(0))
  if (offset === null) return null

  return { line: spot.line, row: spot.row, col: spot.col, offset }
}
