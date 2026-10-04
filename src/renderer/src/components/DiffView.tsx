import type { FileDiff } from '@shared/git'

const MARK: Record<'add' | 'del' | 'context', string> = { add: '+', del: '-', context: ' ' }

interface DiffViewProps {
  diff: FileDiff
  /**
   * 差异为空时的说明。
   * 两个调用方的语义不同 —— 历史里是「那一版这个文件是空的」，
   * 提交前是「内容跟上一版一样」，所以交给调用方给文案。
   */
  emptyHint: string
}

/** 逐行差异。二进制与超限内容已由主进程标记成 skipped，这里只负责说明，不去硬算。 */
export function DiffView({ diff, emptyHint }: DiffViewProps) {
  if (diff.skipped) {
    return <p className="history__hint">这是二进制文件或内容过大，没有做行级对比。</p>
  }

  if (diff.lines.length === 0) {
    return <p className="history__hint">{emptyHint}</p>
  }

  return (
    <div className="diff">
      {diff.lines.map((line, index) => (
        <div className="diff__line" data-kind={line.kind} key={index}>
          <span className="diff__mark">{MARK[line.kind]}</span>
          <span className="diff__text">{line.text === '' ? ' ' : line.text}</span>
        </div>
      ))}
    </div>
  )
}
