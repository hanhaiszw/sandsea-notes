interface EmptyStateProps {
  notice: string | null
  /** 默认笔记库位置；还没读到时为 null，此时默认按钮置灰 */
  defaultPath: string | null
  onChoose: () => void
  onUseDefault: () => void
}

/**
 * 首次启动的欢迎页。
 *
 * 这里不再只给一个「选择文件夹」——用户此刻还没见过这个应用长什么样，
 * 被要求先决定「用哪个文件夹」是个他没能力做的决定。所以把默认位置直接摆出来，
 * 一个按钮就能开始；想放别处的人再走「选择其他文件夹」。
 */
export function EmptyState({ notice, defaultPath, onChoose, onUseDefault }: EmptyStateProps) {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__title">笔记就是你磁盘上的 Markdown 文件</h1>
        <p className="welcome__lead">
          笔记以 Markdown 文件原样保存在一个文件夹里，随时可以更换，也能用其他编辑器直接打开。
        </p>

        {defaultPath ? (
          <div className="welcome__path">
            <span className="welcome__path-label">默认位置</span>
            <span className="welcome__path-value">{defaultPath}</span>
          </div>
        ) : null}

        <div className="welcome__actions">
          <button
            className="button button--primary"
            disabled={!defaultPath}
            onClick={onUseDefault}
            type="button"
          >
            用这个位置开始
          </button>
          <button className="button" onClick={onChoose} type="button">
            选择其他文件夹
          </button>
        </div>

        <p className="welcome__hint">
          选默认位置会新建这个文件夹，并在里面放一篇引导笔记。之后想换地方，点侧栏顶部的
          「更换文件夹」。本地版本历史会自动开好，不用额外配置。
        </p>

        {notice ? <p className="welcome__notice">{notice}</p> : null}
      </div>
    </div>
  )
}
