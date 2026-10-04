import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { TEXT_COLORS, applyTextColor, clearTextColor } from './textColor'

/**
 * Markdown 排版动作。
 *
 * 工具栏按钮和快捷键共用这里的实现，避免同一动作有两套行为。
 */

/** 行首已有的块级标记：标题 / 有序 / 无序（含任务项）/ 引用，缩进保留 */
const BLOCK_MARKER = /^(\s*)(?:#{1,6}\s+|\d+\.\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*)?/

/** 任务项标记（含已勾选），用于判断「这一行已经是待办项」 */
const TASK_MARKER = /^[-*+]\s+\[[ xX]\]\s+$/

/** 用标记包裹选区；没有选区时插入占位文字并选中它，方便直接替换 */
export function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string
): void {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)

  if (selected) {
    view.dispatch({
      changes: [
        { from, insert: before },
        { from: to, insert: after }
      ],
      selection: EditorSelection.range(from + before.length, to + before.length)
    })
  } else {
    view.dispatch({
      changes: { from, insert: `${before}${placeholder}${after}` },
      selection: EditorSelection.range(from + before.length, from + before.length + placeholder.length)
    })
  }

  view.focus()
}

interface ToggleOptions {
  /** 判定「已经应用过」的规则，默认按前缀字面量判断 */
  applied?: RegExp
}

/**
 * 切换行级标记（标题、列表、任务项、引用）。
 *
 * 所有选中行都已应用该标记时取消标记，否则统一替换为它 ——
 * 替换而不是叠加，所以把引用行改成列表不会出现「> - 」这种混合标记。
 */
export function toggleLinePrefix(
  view: EditorView,
  prefix: string,
  options: ToggleOptions = {}
): void {
  const { from, to } = view.state.selection.main
  const firstLine = view.state.doc.lineAt(from).number
  const lastLine = view.state.doc.lineAt(to).number

  const rows = []
  for (let number = firstLine; number <= lastLine; number += 1) {
    const line = view.state.doc.line(number)
    const match = BLOCK_MARKER.exec(line.text)
    const indent = match?.[1] ?? ''
    const matched = match?.[0] ?? ''
    // 判定「已应用」必须拿匹配到的标记本身比较，而不是标记之后的正文：
    // 用正文判断的话，对已经是「## 标题」的行再点 H2 永远判不出「已应用」，
    // 也就无法取消标记。
    const marker = matched.slice(indent.length)

    rows.push({
      markerStart: line.from + indent.length,
      markerEnd: line.from + matched.length,
      applied: options.applied ? options.applied.test(marker) : marker === prefix
    })
  }

  const remove = rows.every((row) => row.applied)

  view.dispatch({
    changes: rows.map((row) => ({
      from: row.markerStart,
      to: row.markerEnd,
      insert: remove ? '' : prefix
    }))
  })
  view.focus()
}

/** 在当前行插入一个块级片段，必要时补空行，避免与相邻内容粘在一起 */
export function insertBlock(view: EditorView, block: string): void {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)

  const before = line.text.trim() === '' ? '' : '\n'
  const text = `${before}${block}\n`

  view.dispatch({
    changes: { from: line.to, insert: text },
    selection: EditorSelection.cursor(line.to + text.length)
  })
  view.focus()
}

export type ActionGroup = 'inline' | 'heading' | 'list' | 'insert'

export interface EditorAction {
  id: string
  /** 工具栏上的显示文字 */
  label: string
  /** 悬停说明，包含快捷键 */
  title: string
  group: ActionGroup
  run: (view: EditorView) => void
}

const CODE_BLOCK_SNIPPET = ['```', '代码', '```', ''].join('\n')

const MERMAID_SNIPPET = ['```mermaid', 'graph TD', '  A[开始] --> B[结束]', '```', ''].join('\n')

/**
 * 生成一个 columns 列 rows 行的空表格。
 *
 * rows 是**连表头在内的总行数** —— Markdown 表格必须有表头行，
 * 所以选 3 行得到的是 1 行表头 + 2 行正文，渲染出来正好 3 行，
 * 与选择器上显示的「N 列 × M 行」一致。
 */
export function buildTable(columns: number, rows: number): string {
  const cells = (fill: (index: number) => string): string =>
    `| ${Array.from({ length: columns }, (_, index) => fill(index)).join(' | ')} |`

  const lines = [
    cells((index) => `列 ${index + 1}`),
    cells(() => '---'),
    ...Array.from({ length: Math.max(rows - 1, 0) }, () => cells(() => '  '))
  ]

  return `${lines.join('\n')}\n`
}

export const EDITOR_ACTIONS: EditorAction[] = [
  {
    id: 'bold',
    label: 'B',
    title: '加粗（Cmd/Ctrl+B）',
    group: 'inline',
    run: (view) => wrapSelection(view, '**', '**', '加粗文字')
  },
  {
    id: 'italic',
    label: 'I',
    title: '斜体（Cmd/Ctrl+I）',
    group: 'inline',
    run: (view) => wrapSelection(view, '*', '*', '斜体文字')
  },
  {
    id: 'strikethrough',
    label: 'S',
    title: '删除线',
    group: 'inline',
    run: (view) => wrapSelection(view, '~~', '~~', '删除线')
  },
  {
    id: 'code-inline',
    label: '<>',
    title: '行内代码',
    group: 'inline',
    run: (view) => wrapSelection(view, '`', '`', '代码')
  },
  {
    id: 'link',
    label: '链接',
    title: '插入链接',
    group: 'inline',
    run: (view) => wrapSelection(view, '[', '](https://)', '链接文字')
  },
  {
    id: 'text-color',
    label: '颜色',
    title: '文字颜色',
    group: 'inline',
    // 工具栏上是取色器（见 textColorAction / clearTextColorAction），这里保留一个默认色
    run: (view) => applyTextColor(view, TEXT_COLORS[0])
  },

  {
    id: 'h1',
    label: 'H1',
    title: '一级标题',
    group: 'heading',
    run: (view) => toggleLinePrefix(view, '# ')
  },
  {
    id: 'h2',
    label: 'H2',
    title: '二级标题',
    group: 'heading',
    run: (view) => toggleLinePrefix(view, '## ')
  },
  {
    id: 'h3',
    label: 'H3',
    title: '三级标题',
    group: 'heading',
    run: (view) => toggleLinePrefix(view, '### ')
  },

  {
    id: 'bullet-list',
    label: '•',
    title: '无序列表',
    group: 'list',
    run: (view) => toggleLinePrefix(view, '- ')
  },
  {
    id: 'ordered-list',
    label: '1.',
    title: '有序列表',
    group: 'list',
    run: (view) => toggleLinePrefix(view, '1. ')
  },
  {
    id: 'task',
    label: '☐',
    title: '待办项（再点一次取消）',
    group: 'list',
    run: (view) => toggleLinePrefix(view, '- [ ] ', { applied: TASK_MARKER })
  },
  {
    id: 'quote',
    label: '❝',
    title: '引用',
    group: 'list',
    run: (view) => toggleLinePrefix(view, '> ')
  },

  {
    id: 'code-block',
    label: '```',
    title: '代码块',
    group: 'insert',
    run: (view) => insertBlock(view, CODE_BLOCK_SNIPPET)
  },
  {
    id: 'table',
    label: '表格',
    title: '插入表格',
    group: 'insert',
    // 工具栏上的表格按钮走尺寸选择器（见 tableAction），这里保留一个默认尺寸
    run: (view) => insertBlock(view, buildTable(3, 3))
  },
  {
    id: 'mermaid',
    label: '图',
    title: '插入 Mermaid 图表',
    group: 'insert',
    run: (view) => insertBlock(view, MERMAID_SNIPPET)
  },
  {
    id: 'hr',
    label: '─',
    title: '分隔线',
    group: 'insert',
    run: (view) => insertBlock(view, '---\n')
  }
]

export function findAction(id: string): EditorAction {
  const action = EDITOR_ACTIONS.find((item) => item.id === id)
  if (!action) throw new Error(`未知的编辑动作：${id}`)
  return action
}

/**
 * 由表格动作派生出「插入指定行列」的动作。
 *
 * 这样工具栏不用知道表格是怎么拼出来的，仍然只跟 EditorAction 打交道，
 * 插入位置、补空行这些细节都留在这一层。
 */
export function tableAction(columns: number, rows: number): EditorAction {
  return {
    ...findAction('table'),
    run: (view) => insertBlock(view, buildTable(columns, rows))
  }
}

/** 由文字颜色动作派生出「给选区上某个颜色」的动作 */
export function textColorAction(color: string): EditorAction {
  return {
    ...findAction('text-color'),
    run: (view) => applyTextColor(view, color)
  }
}

/** 去掉选区所在的颜色标记 */
export function clearTextColorAction(): EditorAction {
  return {
    ...findAction('text-color'),
    run: (view) => clearTextColor(view)
  }
}
