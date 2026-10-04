import type { ReactNode } from 'react'

import { hoverTip } from './HoverTip'

/** 右栏还没选中文件时的提示；历史面板与提交弹窗共用 */
export const DIFF_EMPTY_HINT = '从左边选一个文件，看看它改了什么。'

interface DiffHeaderProps {
  path: string
  added: number
  removed: number
  /** 额外操作（历史面板的「恢复成这一版」）；提交弹窗没有 */
  children?: ReactNode
}

/**
 * 差异区的标题栏：文件路径 + 增删行数。
 *
 * 历史面板与提交弹窗的右栏是同一种东西，早先两处各写了一遍，
 * 改行数样式时容易只改到一边。
 */
export function DiffHeader({ path, added, removed, children }: DiffHeaderProps) {
  return (
    <header className="history__bar">
      <span className="history__path" {...hoverTip(path)}>
        {path}
      </span>
      <span className="stats">
        <span className="stats__added">+{added}</span>
        <span className="stats__removed">−{removed}</span>
      </span>
      {children}
    </header>
  )
}
