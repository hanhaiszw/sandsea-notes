import { Modal } from './Modal'

/**
 * 语法参考。
 *
 * 是普通外链：主进程的 setWindowOpenHandler 会把它交给系统浏览器打开，
 * 应用自身不加载任何远程资源（见 src/main/index.ts）。
 */
const MARKDOWN_REFERENCE = 'https://www.runoob.com/markdown/md-tutorial.html'

const FEATURES = [
  '源码编辑 + 实时预览，停止输入约 0.7 秒自动保存；编辑 / 分栏 / 阅读三种视图',
  '标题、列表、待办、表格、文字颜色一键插入，Mermaid 图表直接渲染',
  '截图 Cmd+V 自动存进笔记库并生成引用，预览里拖一下就能改图片大小',
  '接上 GitHub / Gitee 一键提交推送；本机没装 git 也能用（内置实现）',
  '深浅色主题跟随系统；除你配置的 Git 远程外不发起任何网络请求，无遥测'
]

interface AboutDialogProps {
  onClose: () => void
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  return (
    <Modal
      description={`版本 ${window.notes.version}`}
      footer={
        <button className="button button--primary" onClick={onClose} type="button">
          关闭
        </button>
      }
      onClose={onClose}
      title="关于 Sandsea Notes"
    >
      <p className="about__lead">
        本地优先的 Markdown 笔记软件。笔记就是你磁盘上的 <code>.md</code> 文件，用任何编辑器都能
        打开，不会被锁进某个数据库；需要多端同步时，把这个文件夹接上 Git 仓库就行。
      </p>

      <h3 className="about__heading">能做什么</h3>
      <ul className="about__list">
        {FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      <h3 className="about__heading">语法参考</h3>
      <ul className="about__list">
        <li>
          <a href={MARKDOWN_REFERENCE} rel="noreferrer" target="_blank">
            Markdown 教程
          </a>
          <span className="about__note"> —— 菜鸟教程，中文，从标题到表格都有示例</span>
        </li>
      </ul>
    </Modal>
  )
}
