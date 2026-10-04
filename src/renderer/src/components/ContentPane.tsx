import type { EditorView } from '@codemirror/view'
import { useDeferredValue, useEffect, useRef, useState } from 'react'

import { assetUrl, isImageFile } from '@shared/notes'

import { useVaultStore } from '../store/vaultStore'
import {
  copySelection,
  cutSelection,
  pasteClipboard,
  selectAll,
  selectedText
} from '../editor/clipboard'
import { attachScrollSync } from '../editor/scrollSync'
import { ContextMenu } from './ContextMenu'
import { Editor, type EditorHandle } from './Editor'
import { EditorToolbar } from './EditorToolbar'
import { Preview } from './Preview'

type ViewMode = 'edit' | 'split' | 'read'

const VIEW_ORDER: ViewMode[] = ['edit', 'split', 'read']
const VIEW_LABEL: Record<ViewMode, string> = { edit: '编辑', split: '分栏', read: '阅读' }

/**
 * 编辑区。
 *
 * 编辑器与预览始终挂载，只靠 CSS 隐藏 —— 否则切换视图会销毁 CodeMirror 实例，
 * 撤销历史和光标位置都会丢。预览内容用 useDeferredValue 延后一帧，
 * 避免每次按键都重跑整篇 Markdown 渲染。
 */
export function ContentPane() {
  const activePath = useVaultStore((state) => state.activePath)
  const content = useVaultStore((state) => state.content)
  const savedContent = useVaultStore((state) => state.savedContent)
  const saveState = useVaultStore((state) => state.saveState)
  const setContent = useVaultStore((state) => state.setContent)
  const setNotice = useVaultStore((state) => state.setNotice)
  const save = useVaultStore((state) => state.save)

  const [mode, setMode] = useState<ViewMode>('split')
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  /**
   * 编辑器里的右键菜单。
   * hasSelection 在**打开菜单那一刻**记下来：菜单开着的时候选区不会变，
   * 而把它放进 state 才能让「剪切 / 复制」直接决定灰不灰。
   */
  const [editorMenu, setEditorMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
  } | null>(null)
  const deferredContent = useDeferredValue(content ?? '')
  const editorRef = useRef<EditorHandle>(null)
  const previewPaneRef = useRef<HTMLDivElement | null>(null)

  // 图片没有源码可编辑，也没有未保存状态，整条编辑链路都绕开
  const viewingImage = activePath !== null && isImageFile(activePath)

  /**
   * 分栏时把两边的滚动绑在一起。
   *
   * 依赖 editorView 这个「当前活着的实例」，而不是在挂载时抓一次快照：
   * 开发模式下 StrictMode 会把编辑器销毁重建，抓下来的快照就变成死对象，
   * 监听器挂在被移除的滚动容器上，表现成「滚了没反应」。编辑器卸载时会
   * 回调 null，这个 effect 随即解绑；预览内容变了不用重绑，锚点每次同步都会重新量。
   */
  useEffect(() => {
    if (mode !== 'split' || editorView === null) return

    const preview = previewPaneRef.current?.querySelector<HTMLElement>('.preview')
    if (!preview) return

    return attachScrollSync({ view: editorView, preview })
  }, [mode, editorView])

  if (!activePath || (!viewingImage && content === null)) {
    return (
      <div className="content__hint">
        {activePath ? '这个文件暂时无法显示' : '从左侧选择一个文件'}
      </div>
    )
  }

  const openEditorMenu = (event: React.MouseEvent): void => {
    if (editorView === null) return
    event.preventDefault()
    setEditorMenu({
      x: event.clientX,
      y: event.clientY,
      hasSelection: selectedText(editorView) !== ''
    })
  }

  /** 剪贴板动作是异步的（要过主进程），失败原因走底栏上方的 notice */
  const runClipboard = (action: (view: EditorView) => Promise<string | null>): void => {
    if (editorView === null) return
    void action(editorView).then((error) => {
      if (error) setNotice(error)
    })
  }

  const dirty = content !== null && content !== savedContent
  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : dirty
          ? '未保存'
          : '已保存'

  return (
    <>
      <header className="doc">
        {viewingImage ? (
          <span className="doc__meta">图片</span>
        ) : (
          <span className="doc__meta" data-dirty={dirty}>
            {saveLabel}
          </span>
        )}

        {/* 图片没有可切换的视图 */}
        {viewingImage ? null : (
          <div className="segmented">
            {VIEW_ORDER.map((item) => (
              <button
                className="segmented__item"
                data-active={item === mode}
                key={item}
                onClick={() => setMode(item)}
                type="button"
              >
                {VIEW_LABEL[item]}
              </button>
            ))}
          </div>
        )}
      </header>

      {viewingImage ? (
        <div className="image-view">
          <img alt={activePath.slice(activePath.lastIndexOf('/') + 1)} src={assetUrl(activePath)} />
        </div>
      ) : (
        <>
          {/* 阅读模式下没有编辑动作，工具栏一并隐藏 */}
          {mode === 'read' ? null : (
            <EditorToolbar onAction={(action) => editorRef.current?.run(action)} />
          )}

          <div className="panes" data-mode={mode}>
            <div className="pane" data-hidden={mode === 'read'} onContextMenu={openEditorMenu}>
              <Editor
                filePath={activePath}
                onChange={setContent}
                onNotice={setNotice}
                onSave={() => void save()}
                onViewChange={setEditorView}
                ref={editorRef}
                value={content ?? ''}
              />
            </div>
            <div className="pane pane--preview" data-hidden={mode === 'edit'} ref={previewPaneRef}>
              <Preview
                filePath={activePath}
                onAction={(action) => editorRef.current?.applyPreviewAction(action)}
                onNotice={setNotice}
                onResizeImage={(target) => editorRef.current?.setImageWidth(target)}
                source={deferredContent}
              />
            </div>
          </div>
        </>
      )}

      {/* 编辑区右键菜单：没有选区时「剪切 / 复制」置灰，其余照常 */}
      {editorMenu ? (
        <ContextMenu
          items={[
            {
              id: 'cut',
              label: '剪切',
              disabled: !editorMenu.hasSelection,
              onSelect: () => runClipboard(cutSelection)
            },
            {
              id: 'copy',
              label: '复制',
              disabled: !editorMenu.hasSelection,
              onSelect: () => runClipboard(copySelection)
            },
            { id: 'paste', label: '粘贴', onSelect: () => runClipboard(pasteClipboard) },
            {
              id: 'select-all',
              label: '全选',
              onSelect: () => {
                if (editorView) selectAll(editorView)
              }
            }
          ]}
          onClose={() => setEditorMenu(null)}
          x={editorMenu.x}
          y={editorMenu.y}
        />
      ) : null}
    </>
  )
}
