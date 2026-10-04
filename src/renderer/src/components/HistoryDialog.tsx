import { useGitStore } from '../store/git'
import { ChangeList } from './ChangeList'
import { DiffHeader, DIFF_EMPTY_HINT } from './DiffHeader'
import { DiffView } from './DiffView'
import { hoverTip } from './HoverTip'
import { Modal } from './Modal'

function formatTime(timestamp: number): string {
  if (!timestamp) return ''
  const at = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * 历史面板。
 *
 * 三层信息横着排开：提交记录 | 改动文件 | 差异。三层都常驻，
 * 点哪一层右边就跟着换 —— 与提交弹窗是同一套逻辑（左边选、右边看），
 * 所以不需要「返回上一级」这种按钮。
 *
 * 这里只读 + 恢复单个文件，不做整仓回滚：那是不可逆操作，
 * 交给命令行或图形化 git 客户端更合适。
 */
export function HistoryDialog() {
  const open = useGitStore((state) => state.historyOpen)
  const commits = useGitStore((state) => state.commits)
  const selectedCommit = useGitStore((state) => state.selectedCommit)
  const files = useGitStore((state) => state.files)
  const diff = useGitStore((state) => state.diff)
  const busy = useGitStore((state) => state.historyBusy)
  const error = useGitStore((state) => state.historyError)
  const close = useGitStore((state) => state.closeHistory)
  const selectCommit = useGitStore((state) => state.selectCommit)
  const openDiff = useGitStore((state) => state.openDiff)
  const restoreFile = useGitStore((state) => state.restoreFile)

  if (!open) return null

  /** 中栏：选中的那次提交改了哪些文件 */
  function changedFiles() {
    if (commits.length === 0) return null
    if (selectedCommit === null) return <p className="history__hint">从左边选一次提交。</p>
    if (busy) return <p className="history__hint">正在读取…</p>
    if (files.length === 0) return <p className="history__hint">这次提交没有改动任何文件。</p>

    return (
      <ChangeList
        activePath={diff?.path}
        files={files}
        onOpen={(path) => void openDiff(path)}
      />
    )
  }

  return (
    <Modal
      busy={busy}
      description="提交记录存在笔记库的 .git 目录里，全部在本机。恢复只会改动工作区的文件，不会自动提交。"
      footer={
        <button className="button" disabled={busy} onClick={close} type="button">
          关闭
        </button>
      }
      onClose={close}
      size="wide"
      title="文件历史"
    >
      {error ? <p className="modal__alert">{error}</p> : null}

      <div className="review review--three">
        <aside className="review__aside">
          {commits.length === 0 && !busy ? (
            <p className="history__hint">这个笔记库还没有提交记录。</p>
          ) : null}

          {commits.map((commit) => (
            <button
              className="history__commit"
              data-active={commit.oid === selectedCommit?.oid}
              key={commit.oid}
              onClick={() => void selectCommit(commit)}
              /* 列窄时提交信息会被省略号截断，提示挂在整行按钮上，
                 悬停在行内任何位置都能看到完整信息 */
              {...hoverTip(commit.message || '(无提交信息)')}
              type="button"
            >
              <span className="history__subject">{commit.message || '(无提交信息)'}</span>
              <span className="history__meta">
                {formatTime(commit.timestamp)} · {commit.shortOid}
              </span>
            </button>
          ))}
        </aside>

        <aside className="review__aside">{changedFiles()}</aside>

        <section className="review__body">
          {diff ? (
            <>
              <DiffHeader added={diff.added} path={diff.path} removed={diff.removed}>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void restoreFile(diff.path)}
                  type="button"
                >
                  恢复成这一版
                </button>
              </DiffHeader>

              {diff.skipped ? (
                <p className="history__hint">
                  这是二进制文件或内容过大，没有做行级对比。可以恢复整份文件。
                </p>
              ) : (
                <DiffView diff={diff} emptyHint="这个文件在这一版里是空的。" />
              )}
            </>
          ) : (
            <p className="history__hint">{DIFF_EMPTY_HINT}</p>
          )}
        </section>
      </div>
    </Modal>
  )
}
