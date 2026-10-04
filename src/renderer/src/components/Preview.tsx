import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'

import { parentOf } from '@shared/notes'

import type { ImageResizeTarget } from '../editor/imageResize'
import type { CellEdit, PreviewAction } from '../editor/previewAction'
import { renderMarkdown } from '../markdown/pipeline'
import {
  ARROWS,
  FLUSH_DELAY,
  caretLines,
  caretOffset,
  cellAt,
  caretPosition,
  findCell,
  placeCaret,
  placeCaretAt,
  readLine,
  type CaretSpot,
  type CellSpot
} from '../preview/tableCells'
import { useImageResize } from '../preview/useImageResize'
import { usePrefsStore } from '../store/prefsStore'
import { ContextMenu } from './ContextMenu'
import { Mermaid } from './Mermaid'

interface PreviewProps {
  source: string
  /** 当前笔记在笔记库内的相对路径；文档里的相对图片地址以它所在目录为基准 */
  filePath: string
  /** 拖拽图片右下角后回传新的宽度，由编辑器写回源码 */
  onResizeImage: (target: ImageResizeTarget) => void
  /** 预览里直接做的编辑（勾选待办、改单元格、增删行列），由编辑器写回源码 */
  onAction: (action: PreviewAction) => void
  /** 需要告知用户的失败原因（剪贴板读写失败等） */
  onNotice: (message: string) => void
}

/** 在某一格上按右键时记下的那一格，以及菜单里各项的可用性 */
interface CellMenu {
  x: number
  y: number
  spot: CellSpot
  /** 格内有选中文字时才能剪切 / 复制 */
  hasSelection: boolean
  canDeleteRow: boolean
  canDeleteColumn: boolean
}

export function Preview({ source, filePath, onResizeImage, onAction, onNotice }: PreviewProps) {
  const theme = usePrefsStore((state) => state.resolved)
  const baseDir = parentOf(filePath)
  const segments = useMemo(() => renderMarkdown(source, baseDir), [source, baseDir])

  /**
   * 光标所在的那一格：增删行列都以它为基准。
   * 存元素本身而不是行号 —— 行号每次渲染都可能变，元素只在这次渲染里有效。
   */
  const activeCell = useRef<CellSpot | null>(null)
  /** 动过、还没写回源码的单元格；值是聚焦那一刻的原文，用来判断有没有真的改 */
  const dirtyCells = useRef(new Map<HTMLElement, { spot: CellSpot; original: string }>())
  /** 预览根节点：重渲染之后要在它里面把原来那一格找回来 */
  const rootRef = useRef<HTMLElement | null>(null)
  /** 在某一格上打开的右键菜单；null 表示没开 */
  const [cellMenu, setCellMenu] = useState<CellMenu | null>(null)
  /** 停手后写回源码的定时器 */
  const flushTimer = useRef<number | null>(null)
  /** 输入法正在组字：这期间一个字都不能碰 DOM，否则候选词会断 */
  const composing = useRef(false)
  /** 写完要补回的光标；等预览重渲染之后用 */
  const caretToRestore = useRef<CaretSpot | null>(null)
  /** 拖拽图片右下角改宽度；监听挂在 window 上，摘除由这个 hook 自己负责 */
  const { startResize } = useImageResize(baseDir, onResizeImage)

  const cancelFlush = (): void => {
    if (flushTimer.current === null) return
    window.clearTimeout(flushTimer.current)
    flushTimer.current = null
  }

  /**
   * 把动过的单元格一次性写回源码。
   *
   * keepCaret 表示「写回之后人还要在这一格里接着改」：写回会让预览重渲染、
   * 把这一格的 DOM 整个换掉，不把光标补回去的话，人就被弹出格子了。
   * 补不了光标时索性先不写 —— 内容还留在 dirtyCells 里，离开这张表时会补上，
   * 总好过把别人正在用的选区毁掉。
   */
  const flushCells = (keepCaret: boolean): void => {
    const edits: CellEdit[] = []
    for (const [element, entry] of dirtyCells.current) {
      if (!element.isConnected) continue

      const text = (element.textContent ?? '').trim()
      if (text === entry.original) continue

      edits.push({ line: entry.spot.line, row: entry.spot.row, col: entry.spot.col, text })
    }

    if (edits.length === 0) return

    const caret = keepCaret ? caretPosition() : null
    if (keepCaret && !caret) return

    dirtyCells.current.clear()
    caretToRestore.current = caret
    onAction({ kind: 'set-cells', cells: edits })
  }

  /** 敲字停手 FLUSH_DELAY 之后写回，好让左边源码跟着动 */
  const scheduleFlush = (): void => {
    cancelFlush()
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null
      if (composing.current) return
      flushCells(true)
    }, FLUSH_DELAY)
  }

  /**
   * 重渲染之后把光标放回原来那一格。
   *
   * 放在 layout effect 里：浏览器绘制之前就摆好，看不到跳动。
   */
  useLayoutEffect(() => {
    const pending = caretToRestore.current
    if (!pending) return

    caretToRestore.current = null
    const preview = rootRef.current
    if (!preview) return

    const cell = findCell(preview, pending)
    if (cell) placeCaretAt(cell, pending.offset)
  }, [segments])

  useEffect(() => cancelFlush, [])

  const runTableOp = (op: string, spot: CellSpot): void => {
    // 结构一变整张表都会重建，先把没写完的单元格落回源码
    cancelFlush()
    flushCells(false)

    switch (op) {
      case 'row-above':
        onAction({ kind: 'insert-row', line: spot.line, row: spot.row, where: 'above' })
        break
      case 'row-below':
        onAction({ kind: 'insert-row', line: spot.line, row: spot.row, where: 'below' })
        break
      case 'row-delete':
        onAction({ kind: 'delete-row', line: spot.line, row: spot.row })
        break
      case 'col-left':
        onAction({
          kind: 'insert-column',
          line: spot.line,
          lineEnd: spot.lineEnd,
          col: spot.col,
          where: 'left'
        })
        break
      case 'col-right':
        onAction({
          kind: 'insert-column',
          line: spot.line,
          lineEnd: spot.lineEnd,
          col: spot.col,
          where: 'right'
        })
        break
      case 'col-delete':
        onAction({
          kind: 'delete-column',
          line: spot.line,
          lineEnd: spot.lineEnd,
          col: spot.col
        })
        break
    }
  }

  /**
   * 单元格上的右键菜单。
   *
   * 表格之外一律放行浏览器原生菜单 —— 读笔记时复制、查词还要用它。
   * 行列表格的结构操作原先是一条常驻浮在表格上的操作条，压着正文很碍眼；
   * 改成右键菜单后不占任何地方。
   */
  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    const spot = cellAt(event.target)
    if (!spot) return

    event.preventDefault()
    activeCell.current = spot

    // 右键不一定把焦点交给这一格，而粘贴要靠它落光标
    if (!spot.cell.contains(document.activeElement)) placeCaret(spot.cell, 'end')

    const selection = window.getSelection()
    setCellMenu({
      x: event.clientX,
      y: event.clientY,
      spot,
      hasSelection:
        selection !== null && !selection.isCollapsed && selection.toString() !== '',
      // 表头行不是数据行，最后一列也一样：删掉表格就不成立了
      canDeleteRow: spot.row > 0,
      canDeleteColumn: (spot.cell.closest('tr')?.cells.length ?? 0) > 1
    })
  }

  const copyCell = async (): Promise<void> => {
    const text = window.getSelection()?.toString() ?? ''
    if (text === '') return

    const result = await window.notes.clipboard.writeText(text)
    if (!result.ok) onNotice(result.error)
  }

  const cutCell = async (): Promise<void> => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const result = await window.notes.clipboard.writeText(selection.toString())
    if (!result.ok) {
      onNotice(result.error)
      return
    }

    // 只动 DOM：删掉选区跟手敲删掉是同一件事，源码交给平时的定时写回
    selection.deleteFromDocument()
    scheduleFlush()
  }

  const pasteCell = async (): Promise<void> => {
    const result = await window.notes.clipboard.readText()
    if (!result.ok) {
      onNotice(result.error)
      return
    }
    if (result.data === '') return

    // 单元格是单行模型，换行按写回时的规矩压成空格
    const text = result.data.replace(/\s*\n\s*/g, ' ')
    if (!document.execCommand('insertText', false, text)) {
      onNotice('粘贴失败：没能把内容插进单元格。')
      return
    }
    scheduleFlush()
  }

  const handleClick = (event: ReactMouseEvent<HTMLElement>): void => {
    const node = event.target as HTMLElement

    /**
     * 待办项只认「点在复选框本身」。复选框刻意没有包进 <label>，
     * 点文字不会触发勾选 —— 否则想选一段待办文字复制时会顺手把它勾掉。
     * 复选框是启用状态，浏览器先把 checked 翻转掉，所以这里读到的就是新状态。
     */
    if (!(node instanceof HTMLInputElement)) return
    if (!node.classList.contains('task-list-item-checkbox')) return

    const line = readLine(node.closest('.task-list-item'), 'data-task-line')
    if (line === null) return
    onAction({ kind: 'toggle-task', line, checked: node.checked })
  }

  const handleFocus = (event: ReactFocusEvent<HTMLElement>): void => {
    const spot = cellAt(event.target)
    if (!spot) return

    activeCell.current = spot

    if (dirtyCells.current.has(spot.cell)) return
    dirtyCells.current.set(spot.cell, {
      spot,
      original: (spot.cell.textContent ?? '').trim()
    })
  }

  const handleBlur = (event: ReactFocusEvent<HTMLElement>): void => {
    const spot = cellAt(event.target)
    if (!spot) return

    // 光标还在同一张表里就接着攒，离开整张表才写回
    const next = cellAt(event.relatedTarget)
    if (next && next.line === spot.line) return

    cancelFlush()
    flushCells(false)
  }

  /**
   * 方向键在相邻单元格之间移动。
   *
   * 左右键浏览器本来就会先在格子内挪光标，只有挪到头 / 尾才轮到换格子；
   * 上下键在单行格里浏览器根本不挪，所以只要光标不在首行 / 末行就交给它
   * （多行内容时还能逐行挪），否则换到上 / 下一行的同一列。
   * 到边界就不动（不绕到上一行末尾），和表格软件的习惯一致。
   */
  const moveByArrow = (key: string, spot: CellSpot): boolean => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false

    const caret = selection.getRangeAt(0)
    const row = spot.cell.closest('tr')
    const table = spot.cell.closest('table')
    if (!row || !table) return false

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const forward = key === 'ArrowRight'
      const offset = caretOffset(spot.cell, caret)
      if (offset === null) return false

      const atEdge = forward ? offset === (spot.cell.textContent ?? '').length : offset === 0
      if (!atEdge) return false

      const target = row.cells[spot.col + (forward ? 1 : -1)]
      if (!target) return false

      placeCaret(target, forward ? 'start' : 'end')
      return true
    }

    const down = key === 'ArrowDown'
    const edges = caretLines(spot.cell, caret)
    if (down ? !edges.last : !edges.first) return false

    const target = table.rows[spot.row + (down ? 1 : -1)]?.cells[spot.col]
    if (!target) return false

    // 与左右键同一个约定：往哪边走，就从那一侧的边缘接手
    placeCaret(target, down ? 'start' : 'end')
    return true
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const spot = cellAt(event.target)
    if (!spot) return

    // 单元格里回车会插进 <div> / <br>，表格写回源码时就烂了；当作「这一格改完了」
    if (event.key === 'Enter') {
      event.preventDefault()
      cancelFlush()
      flushCells(false)
      spot.cell.blur()
      return
    }

    // 按住修饰键是扩选、跳词、系统快捷键，一律交给浏览器
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    if (!ARROWS.has(event.key)) return

    if (moveByArrow(event.key, spot)) event.preventDefault()
  }

  const handleInput = (event: ReactFormEvent<HTMLElement>): void => {
    // 输入法组字期间一个字都不能碰 DOM：一写回预览就会重渲染，候选词直接断掉
    if (composing.current || (event.nativeEvent as InputEvent).isComposing) return
    if (!cellAt(event.target)) return
    scheduleFlush()
  }

  const handleCompositionStart = (): void => {
    composing.current = true
    cancelFlush()
  }

  const handleCompositionEnd = (): void => {
    composing.current = false
    scheduleFlush()
  }

  return (
    <article
      className="preview"
      onBlur={handleBlur}
      onClick={handleClick}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onContextMenu={handleContextMenu}
      onFocus={handleFocus}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPointerDown={startResize}
      ref={rootRef}
    >
      {segments.map((segment) =>
        segment.kind === 'html' ? (
          <div
            className="preview__html"
            dangerouslySetInnerHTML={{ __html: segment.html }}
            key={segment.key}
          />
        ) : (
          // 外面这层只为了挂 data-line：分栏同步滚动要靠它把预览位置换算成源码行。
          // 不能挂到 Mermaid 上 —— 那会让 line 变成它的 prop，行号一变小图就重绘。
          <div className="preview__mermaid" data-line={segment.line} key={segment.key}>
            <Mermaid code={segment.code} theme={theme} />
          </div>
        )
      )}

      {cellMenu ? (
        <ContextMenu
          items={[
            {
              id: 'row-above',
              label: '上方插入行',
              onSelect: () => runTableOp('row-above', cellMenu.spot)
            },
            {
              id: 'row-below',
              label: '下方插入行',
              onSelect: () => runTableOp('row-below', cellMenu.spot)
            },
            {
              id: 'row-delete',
              label: '删除本行',
              disabled: !cellMenu.canDeleteRow,
              onSelect: () => runTableOp('row-delete', cellMenu.spot)
            },
            {
              id: 'col-left',
              label: '左侧插入列',
              onSelect: () => runTableOp('col-left', cellMenu.spot)
            },
            {
              id: 'col-right',
              label: '右侧插入列',
              onSelect: () => runTableOp('col-right', cellMenu.spot)
            },
            {
              id: 'col-delete',
              label: '删除本列',
              disabled: !cellMenu.canDeleteColumn,
              onSelect: () => runTableOp('col-delete', cellMenu.spot)
            },
            {
              id: 'cut',
              label: '剪切',
              dividerBefore: true,
              disabled: !cellMenu.hasSelection,
              onSelect: () => void cutCell()
            },
            {
              id: 'copy',
              label: '复制',
              disabled: !cellMenu.hasSelection,
              onSelect: () => void copyCell()
            },
            { id: 'paste', label: '粘贴', onSelect: () => void pasteCell() }
          ]}
          onClose={() => setCellMenu(null)}
          x={cellMenu.x}
          y={cellMenu.y}
        />
      ) : null}
    </article>
  )
}
