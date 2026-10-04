import type { ChangeKind, CommitFile } from '@shared/git'

import { hoverTip } from './HoverTip'

const KIND_LABEL: Record<ChangeKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除'
}

interface ChangeListProps {
  files: CommitFile[]
  /** 超出显示上限、未列出的文件数；0 表示没有截断 */
  hiddenCount?: number
  /** 当前展开的那个文件；列表常驻时用它标出选中项 */
  activePath?: string
  onOpen: (path: string) => void
}

/**
 * 改动文件列表：历史面板与提交弹窗共用，保证两处看起来是同一套东西。
 *
 * 每一行都带行级统计，改了多少一眼可见，不必逐个点开。
 * 二进制与图片不做行级对比（skipped），那一栏留空。
 */
export function ChangeList({ files, hiddenCount = 0, activePath, onOpen }: ChangeListProps) {
  return (
    <ul className="changelist">
      {files.map((file) => (
        <li className="changelist__item changelist__item--button" key={file.path}>
          <button
            className="changelist__open"
            data-active={file.path === activePath}
            onClick={() => onOpen(file.path)}
            /* 列窄时路径会被省略号截断，提示挂在整行按钮上，
               悬停在行内任何位置都能看到完整路径 */
            {...hoverTip(file.path)}
            type="button"
          >
            <span className="changelist__kind" data-kind={file.kind}>
              {KIND_LABEL[file.kind]}
            </span>
            <span className="changelist__path">{file.path}</span>
            {file.skipped ? null : (
              <span className="stats">
                <span className="stats__added">+{file.added}</span>
                <span className="stats__removed">−{file.removed}</span>
              </span>
            )}
          </button>
        </li>
      ))}

      {hiddenCount > 0 ? (
        <li className="changelist__more">另有 {hiddenCount} 个文件未在此列出</li>
      ) : null}
    </ul>
  )
}
