import {
  EDITOR_ACTIONS,
  clearTextColorAction,
  tableAction,
  textColorAction,
  type ActionGroup,
  type EditorAction
} from '../editor/format'
import { TablePicker } from './TablePicker'
import { TextColorPicker } from './TextColorPicker'

const GROUPS: ActionGroup[] = ['inline', 'heading', 'list', 'insert']

/** 让按钮文字自己体现效果：B 显示为粗体、I 为斜体、S 带删除线 */
const EMPHASIS: Record<string, 'bold' | 'italic' | 'strike'> = {
  bold: 'bold',
  italic: 'italic',
  strikethrough: 'strike'
}

interface EditorToolbarProps {
  onAction: (action: EditorAction) => void
}

export function EditorToolbar({ onAction }: EditorToolbarProps) {
  return (
    <div className="toolbar">
      {GROUPS.map((group, groupIndex) => (
        <div className="toolbar__group" key={group}>
          {groupIndex > 0 ? <span className="toolbar__divider" /> : null}
          {EDITOR_ACTIONS.filter((action) => action.group === group).map((action) => {
            // 这两个按钮要先在弹出面板里选参数，不直接执行
            if (action.id === 'table') {
              return (
                <TablePicker
                  key={action.id}
                  onPick={(columns, rows) => onAction(tableAction(columns, rows))}
                  title={action.title}
                />
              )
            }

            if (action.id === 'text-color') {
              return (
                <TextColorPicker
                  key={action.id}
                  onClear={() => onAction(clearTextColorAction())}
                  onPick={(color) => onAction(textColorAction(color))}
                  title={action.title}
                />
              )
            }

            return (
              <button
                className="toolbar__button"
                data-emphasis={EMPHASIS[action.id]}
                key={action.id}
                // 阻止按下时把焦点从编辑器抢走，否则光标位置和选区会丢
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAction(action)}
                title={action.title}
                type="button"
              >
                {action.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
