import type { CommitFile } from '@shared/git'

import { useGitStore } from '../store/git'
import { ChangeList } from './ChangeList'
import { DiffHeader, DIFF_EMPTY_HINT } from './DiffHeader'
import { DiffView } from './DiffView'
import { Modal } from './Modal'

const PREVIEW_LIMIT = 12

export function GitSyncDialog() {
  const open = useGitStore((state) => state.syncDialogOpen)
  const status = useGitStore((state) => state.status)
  const busy = useGitStore((state) => state.busy)
  const behind = useGitStore((state) => state.behindDetected)
  const dialogError = useGitStore((state) => state.dialogError)
  const message = useGitStore((state) => state.commitMessage)
  const setMessage = useGitStore((state) => state.setCommitMessage)
  const close = useGitStore((state) => state.closeSyncDialog)
  const confirmSync = useGitStore((state) => state.confirmSync)
  const confirmCommit = useGitStore((state) => state.confirmCommit)
  const workDiff = useGitStore((state) => state.workDiff)
  const workStats = useGitStore((state) => state.workStats)
  const openWorkDiff = useGitStore((state) => state.openWorkDiff)

  if (!open) return null

  const changed = status?.changed ?? []
  const hidden = Math.max(0, changed.length - PREVIEW_LIMIT)
  const canAct = changed.length > 0 && !busy
  /** 没配远程地址时只能提交到本地：那条路不需要凭证，也不需要比对远端 */
  const hasRemote = Boolean(status?.remoteUrl)

  /**
   * 列表上每行都要带行数，所以得把统计并进条目里。
   * 统计是打开弹窗时整批取回的；缺项（还没回来，或图片之类不做对比）当作 skipped，
   * 那一栏就留空。
   */
  const entries: CommitFile[] = changed.slice(0, PREVIEW_LIMIT).map((file) => ({
    ...file,
    ...(workStats[file.path] ?? { added: 0, removed: 0, skipped: true })
  }))

  return (
    <Modal
      busy={busy}
      description={
        behind
          ? `${changed.length} 个文件的改动，远端已有新提交，无法直接推送`
          : hasRemote
            ? `${changed.length} 个文件的改动将被提交并推送到远程仓库`
            : `${changed.length} 个文件的改动将记入本地版本历史`
      }
      footer={
        <>
          <button className="button" disabled={busy} onClick={close} type="button">
            取消
          </button>
          <button
            className={hasRemote ? 'button' : 'button button--primary'}
            disabled={!canAct}
            onClick={() => void confirmCommit()}
            type="button"
          >
            {hasRemote ? '仅提交到本地' : '提交到历史'}
          </button>
          {hasRemote ? (
            <button
              className="button button--primary"
              disabled={!canAct || behind}
              onClick={() => void confirmSync()}
              type="button"
            >
              {busy ? '处理中…' : '提交并推送'}
            </button>
          ) : null}
        </>
      }
      onClose={close}
      size="wide"
      title={hasRemote ? '同步到远程仓库' : '提交到版本历史'}
    >
      {dialogError ? <p className="modal__alert">{dialogError}</p> : null}

      {behind ? (
        <p className="modal__alert" data-tone="info">
          远端有本地没有的提交，直接推送会被拒绝。可以先用「仅提交到本地」把改动存入版本历史，
          再到状态栏点「拉取」。如果两侧改动了同一个文件，需要在笔记库目录里手工处理。
        </p>
      ) : null}

      <label className="field">
        <span className="field__label">提交信息</span>
        <input
          autoFocus
          className="field__input"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !canAct) return
            // 没有远程地址时回车等于「提交到本地」；有远程且远端领先时不抢动作
            if (!hasRemote) {
              void confirmCommit()
              return
            }
            if (!behind) void confirmSync()
          }}
          value={message}
        />
      </label>

      {/* 与历史面板同一套逻辑：左边常驻列表，点谁右边就显示谁的细节 */}
      <div className="review">
        <aside className="review__aside">
          <ChangeList
            activePath={workDiff?.path}
            files={entries}
            hiddenCount={hidden}
            onOpen={(path) => void openWorkDiff(path)}
          />
          {entries.length === 0 ? <p className="history__hint">没有待提交的改动。</p> : null}
        </aside>

        <section className="review__body">
          {workDiff ? (
            <>
              <DiffHeader added={workDiff.added} path={workDiff.path} removed={workDiff.removed} />

              <DiffView diff={workDiff} emptyHint="这个文件跟上一版相比没有内容变化。" />
            </>
          ) : (
            <p className="history__hint">{DIFF_EMPTY_HINT}</p>
          )}
        </section>
      </div>
    </Modal>
  )
}
