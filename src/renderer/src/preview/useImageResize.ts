import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

import type { ImageResizeTarget } from '../editor/imageResize'

/** 拖拽时的宽度上下限，避免拖出 0 宽或离谱的数值 */
const MIN_IMAGE_WIDTH = 40
const MAX_IMAGE_WIDTH = 4000

/**
 * 预览里拖拽图片右下角改宽度。
 *
 * 拖拽全程直接改 DOM、不走 React state：每移动一帧都 setState 会把整篇预览
 * 连同 Mermaid 一起重渲染，代价太大。
 *
 * 监听挂在 window 上，因此卸载时要摘掉 —— 拖拽途中切文件或切视图的话，
 * 那对监听会一直留着，还继续对着已经不在页面里的图片改宽度。
 */
export function useImageResize(
  /** 当前笔记所在目录；回传的相对路径以它为基准 */
  baseDir: string,
  onResize: (target: ImageResizeTarget) => void
): {
  startResize: (event: ReactPointerEvent<HTMLElement>) => void
} {
  /** 拖拽进行中的解绑函数 */
  const detachRef = useRef<(() => void) | null>(null)

  useEffect(() => () => detachRef.current?.(), [])

  const startResize = (event: ReactPointerEvent<HTMLElement>): void => {
    const handle = (event.target as HTMLElement).closest('.image-handle')
    const frame = handle?.closest('.image-frame')
    const image = frame?.querySelector('img')
    if (!frame || !image) return

    const index = Number(image.getAttribute('data-img-index'))
    const path = image.getAttribute('data-img-path')
    // 没有这些标记的图片（外部地址、解析不出路径、引用式图片）不支持拖拽
    if (!Number.isInteger(index) || path === null) return

    event.preventDefault()
    frame.setAttribute('data-resizing', 'true')

    const startX = event.clientX
    const startWidth = image.getBoundingClientRect().width
    const widthAt = (clientX: number): number =>
      Math.min(
        Math.max(Math.round(startWidth + clientX - startX), MIN_IMAGE_WIDTH),
        MAX_IMAGE_WIDTH
      )

    const move = (moveEvent: PointerEvent): void => {
      image.style.width = `${widthAt(moveEvent.clientX)}px`
    }

    /**
     * 只摘监听，不做别的。
     * 拖拽正常结束时由 finish 调用；拖拽途中组件卸载时由卸载钩子调用
     * （那种情况下不该把宽度写回源码 —— 用户并没有放下鼠标）。
     */
    const detach = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      if (detachRef.current === detach) detachRef.current = null
    }

    const finish = (upEvent: PointerEvent): void => {
      detach()
      frame.removeAttribute('data-resizing')

      // 刻意保留这次拖出来的内联宽度：源码改完、预览重渲染之前，
      // 先撤掉它会让图片弹回原宽度闪一下
      onResize({ index, path, baseDir, width: widthAt(upEvent.clientX) })
    }

    detachRef.current = detach
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  return { startResize }
}
