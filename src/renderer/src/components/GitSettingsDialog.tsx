import { useEffect, useState, type ReactNode } from 'react'

import type { GitBackend, GitSetupInput } from '@shared/git'

import { useGitStore } from '../store/git'
import { useVaultStore } from '../store/vaultStore'
import { Modal } from './Modal'

interface FieldProps {
  label: string
  hint?: ReactNode
  children: ReactNode
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}

/**
 * 版本历史设置。
 *
 * 分两块，顺序和视觉分量都按「本地为主、远程为辅」来：
 * 上面是本地版本历史（打开笔记库时已经自动开好，这里只需要确认署名），
 * 远程那一块收在折叠区里 —— 只想要本地历史的人一眼扫过去就行，
 * 要做多设备同步的人点开再填。
 */
export function GitSettingsDialog() {
  const open = useGitStore((state) => state.settingsOpen)
  const config = useGitStore((state) => state.config)
  const status = useGitStore((state) => state.status)
  const busy = useGitStore((state) => state.busy)
  const notice = useGitStore((state) => state.notice)
  const close = useGitStore((state) => state.closeSettings)
  const saveSettings = useGitStore((state) => state.saveSettings)
  const clearCredential = useGitStore((state) => state.clearCredential)
  const cloneRepo = useGitStore((state) => state.cloneRepo)
  const initLocal = useGitStore((state) => state.initLocal)
  const vaultRoot = useVaultStore((state) => state.info?.rootPath ?? null)
  const hasCredential = useGitStore((state) => state.status?.hasCredential ?? false)

  const [backend, setBackend] = useState<GitBackend>('isomorphic')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')

  useEffect(() => {
    if (!config) return
    setBackend(config.backend)
    setRemoteUrl(config.remoteUrl)
    setBranch(config.branch)
    setUsername(config.username)
    setAuthorName(config.author.name)
    setAuthorEmail(config.author.email)
    // 令牌不回填：读回明文没有必要，留空即表示不修改
    setToken('')
  }, [config])

  if (!open || !config) return null

  /** 自动开启失败时才会遇到；此时这里给一个重试入口 */
  const needsSetup = status?.state === 'no-repo'
  const hasRemote = remoteUrl.trim() !== ''

  const buildInput = (): GitSetupInput => {
    const input: GitSetupInput = {
      backend,
      remoteUrl,
      branch,
      username,
      authorName,
      authorEmail
    }
    return token ? { ...input, token } : input
  }

  return (
    <Modal
      busy={busy}
      description="每次提交都记在笔记库的 .git 里，不联网也能翻看和恢复；想让多台设备同步，再接一个远程仓库。"
      footer={
        <>
          <button className="button" disabled={busy} onClick={close} type="button">
            取消
          </button>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void saveSettings(buildInput())}
            type="button"
          >
            保存
          </button>
        </>
      }
      onClose={close}
      title="版本历史与同步"
    >
      {notice?.tone === 'error' ? <p className="modal__alert">{notice.text}</p> : null}

      <p className="section__label">本地版本历史</p>

      {needsSetup ? (
        <>
          <p className="section__hint">
            这个笔记库还没开启本地版本历史。开启之后每次改动都能翻看、能退回旧版本。
          </p>
          <div className="row">
            <button
              className="button"
              disabled={busy}
              onClick={() => void initLocal()}
              type="button"
            >
              立即开启
            </button>
          </div>
        </>
      ) : (
        <p className="section__hint">
          已开启。历史文件在 <code className="code">{vaultRoot}/.git</code>
          ，用任何 Git 工具都能打开。
        </p>
      )}

      <div className="field">
        <span className="field__label">提交署名</span>
        <div className="row row--fields">
          <input
            aria-label="姓名"
            className="field__input"
            onChange={(event) => setAuthorName(event.target.value)}
            placeholder="姓名"
            value={authorName}
          />
          <input
            aria-label="邮箱"
            className="field__input"
            onChange={(event) => setAuthorEmail(event.target.value)}
            placeholder="邮箱"
            value={authorEmail}
          />
        </div>
        <span className="field__hint">
          写进每一次提交的记录。默认取系统用户名和本机地址，可以改成常用的邮箱 ——
          推送到 GitHub / Gitee 时对方会看到这一项。
        </span>
      </div>

      <details className="advanced">
        {/* 不用受控的 open：开关由用户点，React 重渲染时会把 open 属性写回去，
            跟用户的操作打架。改成把当前状态写进标题，收起时也能看见 */}
        <summary className="advanced__summary">
          推送到远程（可选）{hasRemote ? ' · 已配置' : ''}
        </summary>

        <p className="section__hint">
          想让另一台设备也看到这些笔记时填这里。仓库要先去 GitHub / Gitee 建好，
          填完地址保存即可；之后底栏的按钮会从「提交到历史」变成「同步」。
        </p>

        <Field hint="HTTPS 地址，例如 https://gitee.com/用户名/仓库.git" label="远程地址">
          <input
            className="field__input"
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="https://gitee.com/用户名/仓库.git"
            value={remoteUrl}
          />
        </Field>
        <Field hint="Gitee 需要填你的真实账号名；GitHub 可以留空。" label="账号名">
          <input
            className="field__input"
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </Field>
        <Field
          hint={
            <>
              留空表示不修改已保存的令牌。到哪儿生成：
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                rel="noreferrer"
                target="_blank"
              >
                GitHub
              </a>
              {' · '}
              <a
                href="https://gitee.com/profile/personal_access_tokens"
                rel="noreferrer"
                target="_blank"
              >
                Gitee
              </a>
            </>
          }
          label="访问令牌"
        >
          <input
            className="field__input"
            onChange={(event) => setToken(event.target.value)}
            placeholder="••••••••"
            type="password"
            value={token}
          />
        </Field>

        {hasCredential ? (
          <div className="row">
            <button
              className="button"
              disabled={busy}
              onClick={() => void clearCredential()}
              type="button"
            >
              清除已保存的令牌
            </button>
          </div>
        ) : null}

        <details className="advanced">
          <summary className="advanced__summary">
            高级{backend === 'system' ? '（当前：系统 git）' : ''}
          </summary>
          <Field hint="远程仓库的主分支名。一般保持默认即可。" label="分支">
            <input
              className="field__input"
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
              value={branch}
            />
          </Field>
          <Field
            hint="内置实现无需安装 git，仅支持 HTTPS；系统 git 支持 SSH。一般保持默认。"
            label="实现方式"
          >
            <select
              className="field__input"
              onChange={(event) => setBackend(event.target.value as GitBackend)}
              value={backend}
            >
              <option value="isomorphic">内置实现（无需安装 git）</option>
              <option value="system">系统 git</option>
            </select>
          </Field>
        </details>

        <p className="section__hint">
          远程上已经有这个笔记库的仓库？可以直接把它克隆到本地并切换过去。
        </p>
        <div className="row">
          <button
            className="button"
            disabled={busy}
            onClick={() => void cloneRepo(buildInput())}
            type="button"
          >
            从远程克隆
          </button>
        </div>
      </details>
    </Modal>
  )
}
