import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 把预览里的操作写回源码。
 *
 * 预览是渲染出来的只读 DOM，要在上面勾选待办、改单元格、增删行列，
 * 就得把「DOM 上做的事」翻译成「源码里的某一段文字」。定位统一用
 * 「行号 + 行列下标」：行号来自渲染时打在元素上的 data-line
 * （见 markdown/pipeline.ts），行列下标直接读 DOM 的 rowIndex / cellIndex。
 *
 * 与 imageResize.ts 同一个路数：只负责改文档，改完由编辑器的 updateListener
 * 回流到 vaultStore 自动落盘，这里不碰保存。
 */

/** 一次单元格改写；text 是纯文本，写回时会转义 */
export interface CellEdit {
  /** 表格表头所在的行号，1 基 */
  line: number
  /** DOM 行序，0 是表头 */
  row: number
  /** DOM 列序，0 是第一列 */
  col: number
  text: string
}

export type PreviewAction =
  | { kind: 'toggle-task'; line: number; checked: boolean }
  | { kind: 'set-cells'; cells: CellEdit[] }
  | { kind: 'insert-row'; line: number; row: number; where: 'above' | 'below' }
  | { kind: 'delete-row'; line: number; row: number }
  | { kind: 'insert-column'; line: number; lineEnd: number; col: number; where: 'left' | 'right' }
  | { kind: 'delete-column'; line: number; lineEnd: number; col: number }

interface Change {
  from: number
  to: number
  insert: string
}

/** 任务项的 `- [ ]` / `1. [x]`；第 1 个捕获组是到左方括号为止的前缀 */
const TASK_MARKER = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/

/** 表格里某个 DOM 行对应的源码行号；表头之后紧跟一条分隔行，所以要多跳一行 */
function rowLine(tableLine: number, row: number): number {
  return row === 0 ? tableLine : tableLine + row + 1
}

/** 一个单元格在一行源码里的区间（含两侧空白） */
type Span = [number, number]

/**
 * 按**未转义**的竖线切出一行的各单元格区间。
 *
 * 转义竖线 `\|` 是单元格内容的一部分，不能当分隔符 —— 扫到反斜杠就跳过下一个字符。
 * 行首、行尾那两根竖线会在两侧各切出一个空段，要去掉；空出来的中间单元格要保留。
 */
function cellSpans(line: string): Span[] | null {
  const pipes: number[] = []
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\\') {
      index += 1
      continue
    }
    if (line[index] === '|') pipes.push(index)
  }
  if (pipes.length === 0) return null

  const bounds = [-1, ...pipes, line.length]
  const spans: Span[] = []
  for (let index = 0; index < bounds.length - 1; index += 1) {
    spans.push([bounds[index] + 1, bounds[index + 1]])
  }

  const blank = ([start, end]: Span): boolean => line.slice(start, end).trim() === ''
  if (spans.length > 1 && blank(spans[0])) spans.shift()
  if (spans.length > 1 && blank(spans[spans.length - 1])) spans.pop()
  return spans
}

/** 写回源码前转义：竖线会把表格切断，反斜杠会吃掉后面的字符 */
function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

function rowCells(text: string): string[] | null {
  const spans = cellSpans(text)
  return spans ? spans.map(([start, end]) => text.slice(start, end).trim()) : null
}

function rebuildRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function emptyRow(columns: number): string {
  return `|${Array.from({ length: columns }, () => '  ').join('|')}|`
}

function dispatch(view: EditorView, changes: Change[]): boolean {
  const valid = changes.filter((change) => change.from !== change.to || change.insert !== '')
  if (valid.length === 0) return false

  // CodeMirror 要求变更按下标递增、互不重叠；这些改动各在各的单元格里，排个序就够
  valid.sort((left, right) => left.from - right.from)
  view.dispatch({ changes: valid, userEvent: 'input' })
  return true
}

/** 勾选 / 取消一个待办项：`- [ ]` 与 `- [x]` 之间只换一个字符 */
function toggleTask(view: EditorView, line: number, checked: boolean): boolean {
  const { doc } = view.state
  if (line < 1 || line > doc.lines) return false

  const target = doc.line(line)
  const match = TASK_MARKER.exec(target.text)
  if (!match) return false

  const marker = target.from + match[1].length
  return dispatch(view, [{ from: marker, to: marker + 1, insert: checked ? 'x' : ' ' }])
}

function cellChange(doc: Text, edit: CellEdit): Change | null {
  const line = rowLine(edit.line, edit.row)
  if (line < 1 || line > doc.lines) return null

  const target = doc.line(line)
  const spans = cellSpans(target.text)
  if (!spans || edit.col >= spans.length) return null

  const [start, end] = spans[edit.col]
  const inner = target.text.slice(start, end)
  const text = escapeCell(edit.text)

  /*
   * 保留这一格原本的两侧空白，写回去排版不变。
   * 整格原本就是空白时（`|  |` 那种空单元格）不能照搬 —— 那点空白全挤到
   * 一侧会写成 `|  na|`，按标准写法补两侧各一个空格。
   */
  const insert =
    inner.trim() === ''
      ? ` ${text} `
      : `${inner.slice(0, inner.length - inner.trimStart().length)}${text}${inner.slice(inner.trimEnd().length)}`

  return { from: target.from + start, to: target.from + end, insert }
}

/**
 * 整批改写单元格。
 *
 * 攒成一批而不是一格一次：每次改源码预览都会重渲染，逐格改写会在用户
 * 换单元格时把刚点中的那一格连着重建，焦点当场丢掉。
 */
function setCells(view: EditorView, cells: CellEdit[]): boolean {
  const changes: Change[] = []
  for (const cell of cells) {
    const change = cellChange(view.state.doc, cell)
    if (change) changes.push(change)
  }
  return dispatch(view, changes)
}

/** 表格占用的源码行号（1 基，含首尾） */
function tableLines(doc: Text, line: number, lineEnd: number): number[] | null {
  if (line < 1 || lineEnd < line || lineEnd > doc.lines) return null

  const lines: number[] = []
  for (let current = line; current <= lineEnd; current += 1) lines.push(current)
  return lines
}

function insertRow(view: EditorView, line: number, row: number, where: 'above' | 'below'): boolean {
  const { doc } = view.state
  if (line < 1 || line > doc.lines) return false

  const header = rowCells(doc.line(line).text)
  if (!header) return false

  // 表头上方插一行没有意义，落到「表头下面第一行数据」的位置
  const target = Math.max(1, where === 'above' ? row : row + 1)
  const at = rowLine(line, target)

  // 表格正好收在文档末尾时没有下一行可用，补在文档最后
  const atEnd = at > doc.lines
  const position = atEnd ? doc.length : doc.line(at).from
  const text = `${atEnd ? '\n' : ''}${emptyRow(header.length)}\n`

  return dispatch(view, [{ from: position, to: position, insert: text }])
}

function deleteRow(view: EditorView, line: number, row: number): boolean {
  const { doc } = view.state
  // 表头不是数据行，删掉整张表就散了
  if (row < 1) return false

  const target = rowLine(line, row)
  if (target < 1 || target > doc.lines) return false

  // 连行尾的换行一起删；正好是最后一行时改成连前面的换行一起删
  const source = doc.line(target)
  const last = source.to === doc.length
  return dispatch(view, [
    {
      from: last ? Math.max(0, source.from - 1) : source.from,
      to: last ? source.to : source.to + 1,
      insert: ''
    }
  ])
}

/** 整行重排成 `| a | b |`：增删列要动每一行，逐格插竖线容易把间距越插越乱 */
function rewriteColumn(
  view: EditorView,
  line: number,
  lineEnd: number,
  mutate: (cells: string[], index: number) => boolean
): boolean {
  const { doc } = view.state
  const lines = tableLines(doc, line, lineEnd)
  if (!lines) return false

  // 各行列数对不上时整张表都不动：按表头重排会把这类手写的表格改形，
  // 比如最后一行少写一根竖线（`| 1 |` 表示两列），重排后列数就真变了
  const columns = rowCells(doc.line(line).text)?.length
  if (columns === undefined) return false

  const changes: Change[] = []
  for (const [index, current] of lines.entries()) {
    const target = doc.line(current)
    const cells = rowCells(target.text)
    if (cells === null || cells.length !== columns) return false
    if (!mutate(cells, index)) return false

    changes.push({ from: target.from, to: target.to, insert: rebuildRow(cells) })
  }
  return dispatch(view, changes)
}

function insertColumn(
  view: EditorView,
  line: number,
  lineEnd: number,
  col: number,
  where: 'left' | 'right'
): boolean {
  return rewriteColumn(view, line, lineEnd, (cells, index) => {
    const at = Math.min(where === 'left' ? col : col + 1, cells.length)
    // 第 2 行是分隔行，新列要补一条分隔线，否则表格结构就断了
    cells.splice(at, 0, index === 1 ? '---' : '')
    return true
  })
}

function deleteColumn(view: EditorView, line: number, lineEnd: number, col: number): boolean {
  return rewriteColumn(view, line, lineEnd, (cells) => {
    // 至少留一列，否则表格就没法解析了
    if (cells.length <= 1 || col >= cells.length) return false
    cells.splice(col, 1)
    return true
  })
}

/** 执行一个预览操作；返回 false 表示没能在源码里定位到对应位置 */
export function applyPreviewAction(view: EditorView, action: PreviewAction): boolean {
  switch (action.kind) {
    case 'toggle-task':
      return toggleTask(view, action.line, action.checked)
    case 'set-cells':
      return setCells(view, action.cells)
    case 'insert-row':
      return insertRow(view, action.line, action.row, action.where)
    case 'delete-row':
      return deleteRow(view, action.line, action.row)
    case 'insert-column':
      return insertColumn(view, action.line, action.lineEnd, action.col, action.where)
    case 'delete-column':
      return deleteColumn(view, action.line, action.lineEnd, action.col)
  }
}
