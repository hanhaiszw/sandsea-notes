import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  description?: string
  /** 内容需要横向铺开时用 wide（例如历史面板要并排放列表和详情） */
  size?: 'default' | 'wide'
  /** 操作进行中：此时不允许用 Esc / 点遮罩关掉，免得在途请求回来又写状态 */
  busy?: boolean
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}

/** 焦点陷阱里用来找首尾的可聚焦元素 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  title,
  description,
  size = 'default',
  busy = false,
  onClose,
  children,
  footer
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  /** 打开弹窗前谁持有焦点；关闭后还回去，键盘用户不会掉回页面开头 */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const descriptionId = useId()

  // 只在挂载时记一次：busy 变化会让下面那个 effect 重跑，
  // 那时 activeElement 可能已经落在弹窗内部了
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current

    // 焦点还不在弹窗里时才抢过来：里面的输入框可能自带 autoFocus，
    // 无条件 focus 会把它的光标顶掉
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()

    return () => {
      returnFocusRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 进行中的操作不能被 Esc 打断
        if (!busy) onClose()
        return
      }

      if (event.key !== 'Tab' || !dialog) return

      // 焦点陷阱：Tab 到首尾时绕回来，别让焦点跑到弹窗背后的界面上
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return (
    <div
      className="overlay"
      onMouseDown={() => {
        if (!busy) onClose()
      }}
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title}
        aria-modal="true"
        className={size === 'wide' ? 'modal modal--wide' : 'modal'}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          {description ? (
            <p className="modal__desc" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <div className="modal__body">{children}</div>
        <footer className="modal__foot">{footer}</footer>
      </div>
    </div>
  )
}
