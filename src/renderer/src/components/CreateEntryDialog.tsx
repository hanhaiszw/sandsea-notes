import { useEffect, useState } from 'react'

import { checkEntryName, type EntryKind } from '@shared/notes'

import { useVaultStore } from '../store/vaultStore'
import { Modal } from './Modal'

const TITLE: Record<EntryKind, string> = {
  note: '新建笔记',
  folder: '新建文件夹'
}

const PLACEHOLDER: Record<EntryKind, string> = {
  note: '例如：会议记录',
  folder: '例如：项目资料'
}

export function CreateEntryDialog() {
  const dialog = useVaultStore((state) => state.createDialog)
  const busy = useVaultStore((state) => state.createBusy)
  const error = useVaultStore((state) => state.createError)
  const close = useVaultStore((state) => state.closeCreateDialog)
  const submit = useVaultStore((state) => state.submitCreate)

  const [name, setName] = useState('')

  useEffect(() => {
    // 每次打开都从空开始；上次输入的内容留着会导致误建到错误的名字
    if (dialog) setName('')
  }, [dialog])

  if (!dialog) return null

  const { kind } = dialog
  const check = checkEntryName(name, kind)
  const canSubmit = check.ok && !busy
  const location = dialog.parentPath === '' ? '笔记库根目录' : dialog.parentPath

  return (
    <Modal
      busy={busy}
      description={`创建位置：${location}`}
      footer={
        <>
          <button className="button" disabled={busy} onClick={close} type="button">
            取消
          </button>
          <button
            className="button button--primary"
            disabled={!canSubmit}
            onClick={() => void submit(name)}
            type="button"
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
      onClose={close}
      title={TITLE[kind]}
    >
      {error ? <p className="modal__alert">{error}</p> : null}

      <label className="field">
        <span className="field__label">{kind === 'note' ? '笔记名称' : '文件夹名称'}</span>
        <input
          autoFocus
          className="field__input"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) void submit(name)
          }}
          placeholder={PLACEHOLDER[kind]}
          value={name}
        />

        {name.trim() === '' ? (
          <span className="field__hint">
            {kind === 'note'
              ? '不需要填写扩展名，会自动保存为 Markdown 文件'
              : '文件夹会创建在上面的位置'}
          </span>
        ) : check.ok ? (
          <span className="field__hint">
            将创建 <code className="code">{check.finalName}</code>
          </span>
        ) : (
          <span className="field__hint field__hint--error">{check.message}</span>
        )}
      </label>
    </Modal>
  )
}
