import { useState, type ReactNode } from 'react'

import { parentOf, type FileNode } from '@shared/notes'

import { useVaultStore } from '../store/vaultStore'

/** 在文件树上请求弹出右键菜单：位置 + 新建的目标目录 */
export interface TreeMenuRequest {
  x: number
  y: number
  /**
   * 新建的目标目录：右键目录就是它本身，右键文件就是该文件所在目录，
   * 空白处是笔记库根目录（空串）
   */
  parentPath: string
}

interface FileTreeProps {
  nodes: FileNode[]
  /** 在某一行的位置请求弹出右键菜单 */
  onRequestMenu: (request: TreeMenuRequest) => void
}

/** 默认展开第一层目录：既不淹没界面，又能立刻看清结构 */
function defaultExpandedPaths(nodes: FileNode[]): Set<string> {
  return new Set(nodes.filter((node) => node.type === 'directory').map((node) => node.path))
}

export function FileTree({ nodes, onRequestMenu }: FileTreeProps) {
  const activePath = useVaultStore((state) => state.activePath)
  const openFile = useVaultStore((state) => state.openFile)
  const [expanded, setExpanded] = useState(() => defaultExpandedPaths(nodes))

  const toggle = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 右键目录就建在目录里，右键文件就建在同级 */
  const requestMenu = (event: React.MouseEvent, node: FileNode): void => {
    event.preventDefault()
    // 拦掉冒泡：否则容器上的处理器会把目标目录覆盖成笔记库根目录
    event.stopPropagation()
    onRequestMenu({
      x: event.clientX,
      y: event.clientY,
      parentPath: node.type === 'directory' ? node.path : parentOf(node.path)
    })
  }

  const renderNodes = (list: FileNode[]): ReactNode => (
    <ul className="tree">
      {list.map((node) =>
        node.type === 'directory' ? (
          <li className="tree__item" key={node.path}>
            <button
              aria-expanded={expanded.has(node.path)}
              className="tree__row tree__row--dir"
              onClick={() => toggle(node.path)}
              onContextMenu={(event) => requestMenu(event, node)}
              type="button"
            >
              <span className="tree__caret" data-open={expanded.has(node.path)} />
              <span className="tree__name">{node.name}</span>
            </button>
            {expanded.has(node.path) ? renderNodes(node.children) : null}
          </li>
        ) : (
          <li className="tree__item" key={node.path}>
            <button
              className="tree__row tree__row--file"
              data-active={node.path === activePath}
              onClick={() => void openFile(node.path)}
              onContextMenu={(event) => requestMenu(event, node)}
              title={node.path}
              type="button"
            >
              <span className="tree__caret tree__caret--leaf" />
              <span className="tree__name">{node.name}</span>
            </button>
          </li>
        )
      )}
    </ul>
  )

  return renderNodes(nodes)
}
