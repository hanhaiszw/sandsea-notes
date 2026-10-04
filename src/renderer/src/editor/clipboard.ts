import type { EditorView } from '@codemirror/view'

/**
 * 编辑器右键菜单用的剪贴板动作。
 *
 * 与 format.ts 里的排版动作分开：那些都是同步 dispatch，
 * 而这里要先过主进程读写系统剪贴板，天然是异步的。
 *
 * 约定与 insertImages 一致：返回第一个失败原因，成功返回 null，
 * 由调用方决定怎么提示 —— 编辑器这一层不直接碰全局 notice。
 */

/** 当前选区的文本；没有选区时是空串 */
export function selectedText(view: EditorView): string {
  const { from, to } = view.state.selection.main
  return view.state.sliceDoc(from, to)
}

/** 复制选区到系统剪贴板 */
export async function copySelection(view: EditorView): Promise<string | null> {
  const text = selectedText(view)
  if (text === '') return null

  const result = await window.notes.clipboard.writeText(text)
  return result.ok ? null : result.error
}

/** 剪切：写剪贴板成功之后才动文档，写失败就原样留着 */
export async function cutSelection(view: EditorView): Promise<string | null> {
  const { from, to } = view.state.selection.main
  if (from === to) return null

  const result = await window.notes.clipboard.writeText(view.state.sliceDoc(from, to))
  if (!result.ok) return result.error

  // 等剪贴板的这段时间里文档可能已经变了（自动保存、外部改动重载），
  // 所以落位前把位置夹回当前文档范围，与 insertImages 的处理一致
  const length = view.state.doc.length
  const start = Math.min(from, length)
  view.dispatch({
    changes: { from: start, to: Math.min(to, length), insert: '' },
    selection: { anchor: start },
    scrollIntoView: true
  })
  view.focus()
  return null
}

/** 在光标处插入剪贴板里的文本 */
export async function pasteClipboard(view: EditorView): Promise<string | null> {
  const result = await window.notes.clipboard.readText()
  if (!result.ok) return result.error
  if (result.data === '') return null

  // 用 replaceSelection 而不是缓存的选区：它取的是 dispatch 当下的选区，
  // 不用自己去处理「等待期间选区被改掉」这件事
  view.dispatch(view.state.replaceSelection(result.data), { scrollIntoView: true })
  view.focus()
  return null
}

export function selectAll(view: EditorView): void {
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
  view.focus()
}
