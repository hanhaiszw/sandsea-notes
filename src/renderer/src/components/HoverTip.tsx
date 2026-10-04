import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react'

import { create } from 'zustand'

/**
 * 行内文字被截断时的悬停提示。
 *
 * 不用原生 `title`：macOS 上要等一秒多才浮出来，列表里翻找时基本等不到，
 * 而且样式没法控制、长路径也放不下。这里自己画一个。
 *
 * 提示挂在应用根节点、用 fixed 定位：列表所在的栏是 `overflow: auto`，
 * 挂在行里面的绝对定位元素会被那一栏裁掉，贴边时只剩半截。
 */

interface TipState {
  text: string
  /** 触发元素在视口里的位置；null 表示不显示 */
  rect: { left: number; bottom: number } | null
  show: (text: string, target: HTMLElement) => void
  hide: () => void
}

const useTipStore = create<TipState>((set) => ({
  text: '',
  rect: null,
  show: (text, target) => {
    const box = target.getBoundingClientRect()
    set({ text, rect: { left: box.left, bottom: box.bottom } })
  },
  hide: () => set({ text: '', rect: null })
}))

type TipEvent = MouseEvent<HTMLElement> | FocusEvent<HTMLElement>

/**
 * 给会截断的行用：悬停在**整行**上时浮出完整文字。
 *
 * 刻意挂在整行上而不是里面那截文字上 —— 挂在文字上时只有把鼠标对准那几个字才有反应，
 * 手感是「时灵时不灵」。另外键盘 Tab 到该行也会显示。
 */
export function hoverTip(text: string): {
  onMouseEnter: (event: TipEvent) => void
  onFocus: (event: TipEvent) => void
  onMouseLeave: () => void
  onBlur: () => void
} {
  const show = (event: TipEvent): void => {
    if (text.trim() === '') return
    useTipStore.getState().show(text, event.currentTarget)
  }

  return {
    onMouseEnter: show,
    onFocus: show,
    onMouseLeave: () => useTipStore.getState().hide(),
    onBlur: () => useTipStore.getState().hide()
  }
}

export function HoverTip() {
  const text = useTipStore((state) => state.text)
  const rect = useTipStore((state) => state.rect)

  const ref = useRef<HTMLDivElement | null>(null)
  const [left, setLeft] = useState(0)

  useLayoutEffect(() => {
    if (!rect || !ref.current) return
    // 量完宽度再定左边距：贴到窗口右边界时往回收，免得提示被切掉。
    // 放在 layout effect 里，浏览器绘制之前就已经摆好，看不到跳动。
    const width = ref.current.offsetWidth
    setLeft(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))
  }, [rect, text])

  if (!rect || text === '') return null

  return (
    <div className="hovertip" ref={ref} style={{ left, top: rect.bottom + 6 }}>
      {text}
    </div>
  )
}
