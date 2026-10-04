import { useState } from 'react'

import type { GitStatus } from '@shared/git'

import { useGitStore } from '../store/git'
import { usePrefsStore } from '../store/prefsStore'
import { useVaultStore } from '../store/vaultStore'
import { AboutDialog } from './AboutDialog'

type Tone = 'idle' | 'pending' | 'ready'

function describe(status: GitStatus | null): { label: string; tone: Tone } {
  if (!status) return { label: '正在检查同步状态…', tone: 'idle' }
  if (status.state === 'no-repo') return { label: '本地版本历史还没开启', tone: 'idle' }
  // 只用了本地历史时同样要报出待提交的改动，否则纯本地模式看不到有东西可提交
  if (status.state === 'no-remote') {
    if (status.changed.length === 0) return { label: '本地仓库，暂无待提交的改动', tone: 'ready' }
    return { label: `未提交 ${status.changed.length} 个文件的改动`, tone: 'pending' }
  }
  if (!status.requiresCredential || status.hasCredential) {
    if (status.changed.length === 0) return { label: '没有需要同步的改动', tone: 'ready' }
    return { label: `未同步 ${status.changed.length} 个文件的改动`, tone: 'pending' }
  }
  return { label: '已接入仓库，还需要填写访问令牌', tone: 'pending' }
}

export function StatusBar() {
  const status = useGitStore((state) => state.status)
  const busy = useGitStore((state) => state.busy)
  const behind = useGitStore((state) => state.behindDetected)
  const notice = useGitStore((state) => state.notice)
  const openSettings = useGitStore((state) => state.openSettings)
  const openSyncDialog = useGitStore((state) => state.openSyncDialog)
  const pull = useGitStore((state) => state.pull)
  const clearNotice = useGitStore((state) => state.clearNotice)
  const openHistory = useGitStore((state) => state.openHistory)
  const revealVault = useVaultStore((state) => state.revealVault)
  const themeLabel = usePrefsStore((state) => state.label)
  const cycleTheme = usePrefsStore((state) => state.cycleTheme)

  // 「关于」只有这一个入口，也不需要跨组件共享，状态留在本地就够
  const [aboutOpen, setAboutOpen] = useState(false)

  const { label, tone } = describe(status)
  const repoState = status?.state ?? null
  // 配了远程 → 提交并推送；没配远程 → 也能把改动提交进本地版本历史，那条路不需要凭证
  const canSync =
    (repoState === 'ready' || repoState === 'no-remote') &&
    (status?.changed.length ?? 0) > 0 &&
    (!(status?.requiresCredential ?? false) || (status?.hasCredential ?? false)) &&
    !busy
  // 出现冲突或远端领先时，给用户一个用外部工具处理的出口
  const needsEscapeHatch = behind || notice?.tone === 'error'

  return (
    <>
      <footer className="statusbar">
        <span className="statusbar__state" data-tone={tone}>
          <span className="statusbar__dot" />
          {label}
        </span>

        {notice ? (
          <button
            // 只有提示条是实时区域：底栏状态文案会跟着每次落盘变，
            // 把它也设成 live 会让读屏软件几乎每敲一下都念一遍
            aria-atomic="true"
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
            className="statusbar__notice"
            data-tone={notice.tone}
            onClick={clearNotice}
            title="点击关闭"
            type="button"
          >
            {notice.text}
          </button>
        ) : null}

        <span className="statusbar__spacer" />

        {behind ? (
          <button className="button" disabled={busy} onClick={() => void pull()} type="button">
            拉取
          </button>
        ) : null}

        {needsEscapeHatch ? (
          <button className="button" onClick={() => void revealVault()} type="button">
            打开笔记库文件夹
          </button>
        ) : null}

        <button className="button" onClick={() => setAboutOpen(true)} type="button">
          关于
        </button>
        {/* 只有已经是仓库才有历史可看 */}
        {repoState === 'ready' || repoState === 'no-remote' ? (
          <button className="button" onClick={() => void openHistory()} type="button">
            历史
          </button>
        ) : null}
        <button
          className="button"
          onClick={() => void cycleTheme()}
          title="切换主题：跟随系统 → 白天 → 黑夜"
          type="button"
        >
          {themeLabel}
        </button>

        <button className="button" onClick={() => void openSettings()} type="button">
          设置
        </button>
        <button
          className="button button--primary"
          disabled={!canSync}
          onClick={openSyncDialog}
          type="button"
        >
          {busy ? '处理中…' : repoState === 'ready' ? '同步' : '提交到历史'}
        </button>
      </footer>

      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  )
}
