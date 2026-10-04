import { memo, useEffect, useRef, useState } from 'react'

import type { ResolvedTheme } from '@shared/theme'

/**
 * Mermaid 图表。
 *
 * 两个刻意的设计：
 * 1. 动态 import —— mermaid 体积很大，只有文档里真的出现图表时才加载；
 * 2. memo —— 源码与主题不变时不重新渲染。图表重绘涉及解析和布局，
 *    跟着每次预览更新重跑会明显拖慢输入。
 */

type MermaidApi = typeof import('mermaid').default

let loader: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((module) => module.default)
  return loader
}

let renderSequence = 0

/** 已经用哪个主题初始化过：mermaid.initialize 是全局配置，同一主题不必反复设置 */
let initializedTheme: ResolvedTheme | null = null

async function renderDiagram(code: string, theme: ResolvedTheme): Promise<string> {
  const mermaid = await loadMermaid()

  // 每张图都重跑一遍 initialize 是白费 —— 它只改全局配置，不随图变化
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // strict：启用 mermaid 自身的净化，禁用点击回调与外链
      securityLevel: 'strict',
      // 渲染失败时不要让它往页面里塞自己的错误图，错误由组件来呈现
      suppressErrorRendering: true,
      theme: theme === 'dark' ? 'dark' : 'neutral',
      fontFamily: 'var(--font-ui)'
    })
    initializedTheme = theme
  }

  renderSequence += 1
  const { svg } = await mermaid.render(`notes-mermaid-${renderSequence}`, code)
  return svg
}

interface MermaidProps {
  code: string
  theme: ResolvedTheme
}

export const Mermaid = memo(function Mermaid({ code, theme }: MermaidProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)

    renderDiagram(code, theme)
      .then((svg) => {
        if (cancelled) return
        const host = hostRef.current
        // mermaid 在 securityLevel: strict 下已对输出做过净化
        if (host) host.innerHTML = svg
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [code, theme])

  if (error) {
    return <pre className="mermaid mermaid--error">{`${code}\n\n图表无法渲染：${error}`}</pre>
  }

  return <div className="mermaid" ref={hostRef} />
})
