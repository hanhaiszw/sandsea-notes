import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

import { findAction, type EditorAction } from '../editor/format'
import { applyImageWidth, type ImageResizeTarget } from '../editor/imageResize'
import { insertImages, pickImageFiles } from '../editor/imageInsert'
import { applyPreviewAction, type PreviewAction } from '../editor/previewAction'

/**
 * 编辑器外观。
 *
 * 所有颜色都取自 CSS 变量，因此主题切换不需要重建编辑器 —— 变量一变，颜色就跟着变。
 */
const notesTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--ink-900)',
    color: 'var(--text)',
    fontSize: '13px'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.8',
    overflow: 'auto'
  },
  '.cm-content': {
    padding: '18px 22px 40px',
    caretColor: 'var(--signal)'
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': {
    backgroundColor: 'var(--ink-900)',
    color: 'var(--text-faint)',
    border: 'none',
    paddingRight: '4px'
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-active-line)',
    color: 'var(--text-dim)'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--signal)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection)' }
})

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--md-heading)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--md-heading)', fontWeight: '700' },
  {
    tag: [t.heading3, t.heading4, t.heading5, t.heading6],
    color: 'var(--md-heading)',
    fontWeight: '600'
  },
  { tag: t.strong, color: 'var(--md-strong)', fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--md-link)' },
  { tag: t.monospace, color: 'var(--md-code)', backgroundColor: 'var(--md-code-bg)' },
  { tag: t.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--text)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: 'var(--md-marker)' },
  { tag: t.escape, color: 'var(--md-marker)' }
])

export interface EditorHandle {
  run: (action: EditorAction) => void
  /** 把预览里拖出来的图片宽度写回源码 */
  setImageWidth: (target: ImageResizeTarget) => void
  /** 把预览里的操作（勾选待办、改单元格、增删行列）写回源码 */
  applyPreviewAction: (action: PreviewAction) => void
}

interface EditorProps {
  value: string
  /** 当前笔记在笔记库内的相对路径：切换它时把焦点移回编辑器，同时作为图片引用的基准 */
  filePath: string
  onChange: (next: string) => void
  onSave: () => void
  /** 插入图片失败等需要告知用户的错误 */
  onNotice: (message: string) => void
  /**
   * 编辑器实例创建 / 销毁时回调。
   *
   * 分栏同步滚动靠它跟随「当前活着的那个实例」。不要在别的 effect 里
   * 抓一次 getView() 存起来 —— 开发模式下 StrictMode 会把 effect 跑两遍，
   * 编辑器实例会被销毁重建，抓下来的那个快照就变成了死对象，
   * 监听器还挂在被移除的滚动容器上，表现为「滚了没反应」（踩过）。
   */
  onViewChange: (view: EditorView | null) => void
  ref?: Ref<EditorHandle>
}

export function Editor({
  value,
  filePath,
  onChange,
  onSave,
  onNotice,
  onViewChange,
  ref
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 回调用 ref 转存：这样下面创建编辑器的 effect 不必依赖它们，也就不会重建编辑器
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onNoticeRef = useRef(onNotice)
  const onViewChangeRef = useRef(onViewChange)
  const filePathRef = useRef(filePath)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onNoticeRef.current = onNotice
  onViewChangeRef.current = onViewChange
  filePathRef.current = filePath

  useImperativeHandle(
    ref,
    () => ({
      run: (action) => {
        const view = viewRef.current
        if (!view) return
        action.run(view)
      },
      setImageWidth: (target) => {
        const view = viewRef.current
        if (view && !applyImageWidth(view, target)) {
          // 定位不到就说一声，不要静默失败；最常见的原因是引用式写法，
          // 那种写法在编辑器语法树里拿不到地址，无法确认改的是同一张图
          onNoticeRef.current(
            '没能在源码里定位到这张图片，尺寸未改动。引用式写法（![描述][引用]）暂不支持调整大小。'
          )
        }
      },
      applyPreviewAction: (action) => {
        const view = viewRef.current
        if (view && !applyPreviewAction(view, action)) {
          // 预览和源码之间只靠行号对齐，对不上时宁可什么都不做，也不要改错地方
          onNoticeRef.current(
            action.kind === 'set-cells'
              ? '预览里的改动没能写回源码，这一格的编辑已放弃。'
              : '没能在源码里定位到刚才操作的位置，改动未生效。'
          )
        }
      }
    }),
    []
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    /** 落盘期间用户可能已经切走文件，用 ref 取当下的路径 */
    const insert = (target: EditorView, files: File[], from: number, to: number): void => {
      void insertImages(target, files, filePathRef.current, { from, to }).then((error) => {
        if (error) onNoticeRef.current(error)
      })
    }

    const view = new EditorView({
      parent: host,
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        syntaxHighlighting(markdownHighlight),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          // 剪贴板里只有图片时才接手；纯文本粘贴必须留给默认行为，
          // 否则会把格式化粘贴（比如从网页复制的富文本）一并拦掉
          paste: (event, target) => {
            const files = pickImageFiles(event.clipboardData?.files)
            if (files.length === 0) return false

            event.preventDefault()
            const { from, to } = target.state.selection.main
            insert(target, files, from, to)
            return true
          },
          // 不拦 dragover 的话浏览器不会派发 drop，而是直接去打开被拖进来的文件
          dragover: (event) => {
            if (pickImageFiles(event.dataTransfer?.files).length > 0) event.preventDefault()
            return false
          },
          drop: (event, target) => {
            const files = pickImageFiles(event.dataTransfer?.files)
            if (files.length === 0) return false

            event.preventDefault()
            const position =
              target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
              target.state.selection.main.from
            insert(target, files, position, position)
            return true
          }
        }),
        keymap.of([
          {
            key: 'Mod-b',
            preventDefault: true,
            run: (target) => {
              findAction('bold').run(target)
              return true
            }
          },
          {
            key: 'Mod-i',
            preventDefault: true,
            run: (target) => {
              findAction('italic').run(target)
              return true
            }
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current()
              return true
            }
          },
          // Tab 缩进选中行 / Shift-Tab 反缩进。
          // basicSetup 和 markdownKeymap 都不绑 Tab，不显式绑定的话
          // 按 Tab 会走浏览器默认行为把焦点移出编辑器。
          indentWithTab,
          // 回车延续列表 / 引用，退格删除标记 —— 编辑列表时的手感靠它
          ...markdownKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        notesTheme
      ]
    })

    viewRef.current = view
    // 先广播再聚焦：分栏同步滚动等外部依赖要在实例可用时就能拿到它
    onViewChangeRef.current(view)
    view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
      onViewChangeRef.current(null)
    }
    // 只创建一次；文档内容的变化由下面的 effect 同步
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const current = view.state.doc.toString()
    if (current === value) return

    // 换文件或外部重载：整体替换文档，但把光标夹到新文档范围内保留原位，
    // 否则重载后光标会被丢到行首
    const anchor = Math.min(view.state.selection.main.anchor, value.length)
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor }
    })
  }, [value])

  useEffect(() => {
    viewRef.current?.focus()
  }, [filePath])

  return <div className="editor" ref={hostRef} />
}
