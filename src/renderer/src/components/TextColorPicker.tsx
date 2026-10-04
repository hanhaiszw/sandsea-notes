import { useEffect, useRef, useState } from 'react'

import { TEXT_COLORS } from '../editor/textColor'

interface TextColorPickerProps {
  title: string
  onPick: (color: string) => void
  onClear: () => void
}

/** 文字颜色取色器：点开一排预设色 + 自定义取色 + 清除 */
export function TextColorPicker({ title, onPick, onClear }: TextColorPickerProps) {
  const [open, setOpen] = useState(false)
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

  const pick = (color: string): void => {
    onPick(color)
    setOpen(false)
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
        title={title}
        type="button"
      >
        <svg aria-hidden="true" className="toolbar__icon toolbar__icon--filled" viewBox="0 0 16 16">
          <text fontSize="9.5" fontWeight="600" textAnchor="middle" x="8" y="10.5">
            A
          </text>
          <rect height="2.5" rx="1.25" width="14" x="1" y="12.5" />
        </svg>
      </button>

      {open ? (
        <div className="toolbar-popover">
          <div className="color-picker__swatches">
            {TEXT_COLORS.map((color) => (
              <button
                aria-label={`颜色 ${color}`}
                className="color-picker__swatch"
                key={color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(color)}
                style={{ background: color }}
                title={color}
                type="button"
              />
            ))}
          </div>

          <div className="color-picker__footer">
            {/* 预设覆盖不到的色值用系统取色器补；不拦 mousedown，它需要拿到焦点 */}
            <input
              aria-label="自定义颜色"
              className="color-picker__custom"
              defaultValue={TEXT_COLORS[0]}
              onChange={(event) => pick(event.target.value)}
              type="color"
            />
            <button
              className="color-picker__clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              type="button"
            >
              清除颜色
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
