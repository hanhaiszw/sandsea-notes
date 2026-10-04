import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  onSelect: () => void
  /** 当前上下文里用不上的项（例如没选中文字时的「复制」）：置灰但保留位置 */
  disabled?: boolean
  /** 在这一项之前画一条分隔线，用来给菜单分组 */
  dividerBefore?: boolean
}

interface ContextMenuProps {
  /** 弹出位置，一般取 contextmenu 事件的 clientX / clientY */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * 通用右键菜单。
 *
 * 刻意**不抢焦点**：右键弹出时编辑器里还留着光标与选区，把焦点移到菜单项上会
 * 让「粘贴」看起来无处可插。代价是方向键会先落到编辑器，所以键盘处理挂在
 * window 的**捕获阶段**，在那里先一步拦下来。
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ left: x, top: y })

  /**
   * 键盘高亮的项；-1 表示还没用键盘选过。
   *
   * 刻意不预选第一项：菜单常是右键随手弹出的，一打开就选中「复制」的话，
   * 用户紧接着敲回车会误触发它。按过方向键之后才接管回车。
   */
  const [activeIndex, setActiveIndex] = useState(-1)

  // 贴着窗口右下边缘弹出时往回挪，否则菜单会被窗口裁掉
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: x + width > window.innerWidth ? Math.max(8, x - width) : x,
      top: y + height > window.innerHeight ? Math.max(8, y - height) : y
    })
  }, [x, y])

  useEffect(() => {
    const enabled = items
      .map((item, index) => (item.disabled === true ? -1 : index))
      .filter((index) => index >= 0)

    const nextIndex = (key: string, current: number): number => {
      if (enabled.length === 0) return -1
      if (key === 'Home') return enabled[0]
      if (key === 'End') return enabled[enabled.length - 1]

      const at = enabled.indexOf(current)
      if (at === -1) return key === 'ArrowDown' ? enabled[0] : enabled[enabled.length - 1]

      const delta = key === 'ArrowDown' ? 1 : -1
      return enabled[(at + delta + enabled.length) % enabled.length]
    }

    // 捕获阶段：菜单没有焦点，不在这里抢先处理的话方向键会被编辑器吃掉
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 用 stopImmediatePropagation：否则弹窗上的 Esc 监听也会收到，一次关掉两层
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }

      const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      const isJump = event.key === 'Home' || event.key === 'End'
      if (!isArrow && !isJump && event.key !== 'Enter') return

      // 拦下来别让编辑器收到：否则方向键会同时移动光标
      event.preventDefault()
      event.stopImmediatePropagation()

      if (event.key === 'Enter') {
        const item = activeIndex >= 0 ? items[activeIndex] : undefined
        if (item && item.disabled !== true) {
          item.onSelect()
          onClose()
        }
        return
      }

      setActiveIndex((current) => nextIndex(event.key, current))
    }

    // 用 pointerdown 而不是 click：右键也会先发 pointerdown，
    // 于是「先关掉旧的、再由 contextmenu 打开新的」这个顺序天然成立
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    // 滚动或改变窗口大小之后菜单就不贴着原来那行了，直接收起
    const onViewportChange = (): void => onClose()

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [items, activeIndex, onClose])

  return (
    <div
      aria-label="操作菜单"
      className="context-menu"
      // 按下时别让按钮把焦点抢走：编辑器或单元格里的光标一旦丢了，
      // 「粘贴」就没地方可插
      onMouseDown={(event) => event.preventDefault()}
      ref={ref}
      role="menu"
      style={position}
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {item.dividerBefore ? <span className="context-menu__divider" /> : null}
          <button
            aria-disabled={item.disabled ?? false}
            className="context-menu__item"
            data-active={index === activeIndex}
            disabled={item.disabled ?? false}
            // 键盘高亮跟着鼠标走，两套操作看起来是同一个东西
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            role="menuitem"
            type="button"
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
