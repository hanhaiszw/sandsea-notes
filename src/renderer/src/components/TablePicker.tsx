import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

/** 选择器最多能选多少列 / 行 */
const MAX_COLUMNS = 10
const MAX_ROWS = 10

interface TablePickerProps {
  title: string
  onPick: (columns: number, rows: number) => void
}

/** 方向键 → 行列增量 */
const ARROW_DELTA: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1]
}

/** 把行列数夹在 [1, MAX] 之内 */
function clamp(columns: number, rows: number): { columns: number; rows: number } {
  return {
    columns: Math.min(Math.max(columns, 1), MAX_COLUMNS),
    rows: Math.min(Math.max(rows, 1), MAX_ROWS)
  }
}

/**
 * 表格尺寸选择器：点开一个方格盘，划到哪格就是几列几行。
 *
 * 行列数由代码里的常量决定，通过 CSS 变量传给样式，
 * 免得同一个数字在 TS 和 CSS 里各写一份、改一处忘一处。
 *
 * 键盘：Tab 到按钮后回车打开，方向键移动，回车确认。
 * 方向键只在焦点还留在按钮上时接管 —— 鼠标操作时焦点仍在编辑器里（按钮刻意
 * 阻止了按下抢焦点），那时编辑器该正常响应方向键，不该被这里截胡。
 */
export function TablePicker({ title, onPick }: TablePickerProps) {
  const [open, setOpen] = useState(false)
  /** 当前指向的格子：鼠标悬停与方向键都改它，只保留这一份状态 */
  const [cursor, setCursor] = useState({ columns: 1, rows: 1 })
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 点面板之外或按 Esc 关掉
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const pick = (nextColumns: number, nextRows: number): void => {
    onPick(nextColumns, nextRows)
    setOpen(false)
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!open) return

    // 回车 / 空格在打开状态下表示「就用当前这格」，不再触发按钮自身的开合
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pick(cursor.columns, cursor.rows)
      return
    }

    const delta = ARROW_DELTA[event.key]
    if (!delta) return

    event.preventDefault()
    setCursor((current) => clamp(current.columns + delta[0], current.rows + delta[1]))
  }

  return (
    <div className="toolbar-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={title}
        className="toolbar__button"
        // 阻止按下时把焦点从编辑器抢走，否则光标位置和选区会丢
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={onTriggerKeyDown}
        title={title}
        type="button"
      >
        <svg aria-hidden="true" className="toolbar__icon" viewBox="0 0 16 16">
          <rect height="12" rx="1.5" width="14" x="1" y="2" />
          <path d="M1 6h14M5.75 6v8M10.25 6v8" />
        </svg>
      </button>

      {open ? (
        <div className="toolbar-popover">
          <div
            className="table-picker__grid"
            style={{ '--grid-columns': MAX_COLUMNS } as CSSProperties}
          >
            {Array.from({ length: MAX_ROWS * MAX_COLUMNS }, (_, index) => {
              const column = (index % MAX_COLUMNS) + 1
              const row = Math.floor(index / MAX_COLUMNS) + 1

              return (
                <button
                  aria-label={`${column} 列 ${row} 行`}
                  className="table-picker__cell"
                  data-active={column <= cursor.columns && row <= cursor.rows}
                  key={index}
                  // 阻止按下抢焦点；同时不能进 Tab 顺序，否则一百个格子会淹没键盘导航
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCursor({ columns: column, rows: row })}
                  onClick={() => pick(column, row)}
                  tabIndex={-1}
                  type="button"
                />
              )
            })}
          </div>

          <p className="table-picker__label">{`${cursor.columns} 列 × ${cursor.rows} 行`}</p>
        </div>
      ) : null}
    </div>
  )
}
