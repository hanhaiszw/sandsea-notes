/**
 * 笔记库领域模型与纯函数工具。
 *
 * 本文件同时被主进程与渲染进程引用，因此**不得引入任何 Node 或 DOM 专有 API**。
 */

export interface FileNodeBase {
  /** 文件或目录名 */
  name: string
  /** 相对笔记库根目录的路径，统一使用 POSIX 分隔符（跨平台约定，见方案 §3.4） */
  path: string
}

export interface FileLeaf extends FileNodeBase {
  type: 'file'
}

export interface FileDir extends FileNodeBase {
  type: 'directory'
  children: FileNode[]
}

export type FileNode = FileLeaf | FileDir

/** 可编辑的笔记文件 */
export const NOTE_EXTENSIONS = ['.md', '.markdown'] as const

/** 可作为图片渲染的扩展名（不含点）。粘贴与自定义协议都以此为准 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const

/** 粘贴 / 拖入的图片统一落到笔记库根目录的这个子目录下 */
export const IMAGES_DIR_NAME = 'images'

/** 附件（v1 仅展示，不解析内容） */
export const ATTACHMENT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'] as const

/** 文件树中允许出现的扩展名 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ...NOTE_EXTENSIONS,
  ...ATTACHMENT_EXTENSIONS
])

/** 默认忽略的目录（点开头的目录本身也会被跳过） */
export const DEFAULT_IGNORED_DIRS = ['.git', 'node_modules', '.obsidian', '.trash', '.idea', '.vscode']

/** 单个笔记文件允许读取与写入的上限，超过则拒绝，避免把编辑器拖死 */
export const MAX_NOTE_BYTES = 5 * 1024 * 1024

/**
 * 单张图片的大小上限。
 *
 * 粘贴 / 拖入与预览加载（自定义协议）两侧共用同一个值：
 * 写入放宽、读取收紧会让绕过限制存进来的图片永远显示不出来。
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** 把系统路径归一化为 POSIX 风格，作为跨进程传输的唯一路径格式 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 取 POSIX 风格相对路径的父目录，顶层返回空串 */
export function parentOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? '' : relPath.slice(0, index)
}

/** 取小写扩展名（含点）；点开头的隐藏文件不算扩展名 */
export function extname(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index).toLowerCase()
}

export function isNoteFile(name: string): boolean {
  return (NOTE_EXTENSIONS as readonly string[]).includes(extname(name))
}

export function isAllowedFile(name: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(name))
}

/** 扩展名是否可作图片渲染；接受带点或不带点的写法 */
export function isImageExtension(extension: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension.replace(/^\./, '').toLowerCase())
}

/** 文件是否为可直接查看的图片 */
export function isImageFile(name: string): boolean {
  return isImageExtension(extname(name))
}

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

/** 由 File.type 反查扩展名；浏览器对剪贴板图片给的就是这几个 MIME */
export const IMAGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

/** 取图片的 Content-Type；不是受支持的图片时返回 null */
export function imageMimeType(extension: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[extension.replace(/^\./, '').toLowerCase()] ?? null
}

/** 预览加载笔记库内图片用的自定义协议：主进程注册处理器，渲染层拼 URL */
export const ASSET_SCHEME = 'notes-asset'

export const ASSET_URL_HOST = 'vault'

/** 把笔记库内的 POSIX 相对路径转成预览可用的 <img> 地址 */
export function assetUrl(relativePath: string): string {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
  return `${ASSET_SCHEME}://${ASSET_URL_HOST}/${encoded}`
}

/**
 * 归一化 Markdown 里的图片地址，得到真实的文件路径写法。
 *
 * 两个解析器给出的文本不一样，必须统一后才能比较：
 * - markdown-it 会做百分号编码，`images/中文图.png` 变成 `images/%E4%B8%AD...png`；
 * - Lezer（编辑器语法树）保留原样，尖括号写法还会连 `<` `>` 一起留下。
 *
 * 顺带解决一个真实 bug：拿编码过的地址去拼 `notes-asset://` 会二次编码，
 * 中文文件名的图片会拼出一个找不到的路径。
 */
export function normalizeImageTarget(raw: string): string {
  const trimmed = raw.trim()
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed

  try {
    return decodeURIComponent(unwrapped)
  } catch {
    // 文件名里带字面量 % 时解码会抛错，此时按原样处理
    return unwrapped
  }
}

/**
 * 把 baseDir 下的相对路径解析成笔记库内的 POSIX 路径，顺带消去 `.` 与 `..`。
 *
 * 越出笔记库（`..` 上溯过头）时返回 null，由调用方决定怎么降级 ——
 * 这里不抛异常，因为它同时也被渲染层用来判断一个图片地址是否可用。
 */
export function resolvePosixPath(baseDir: string, target: string): string | null {
  const segments = baseDir ? baseDir.split('/').filter(Boolean) : []

  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue

    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }

    segments.push(part)
  }

  return segments.join('/')
}

/**
 * 求「从 fromDir 指向 targetPath」的相对路径，用 `..` 上溯。
 *
 * 用于插入图片引用：图片固定在笔记库根目录的 images/ 下，
 * 而笔记可能位于任意层级的子目录，必须按层级算出正确的前缀。
 */
export function relativePosixPath(fromDir: string, targetPath: string): string {
  const from = fromDir ? fromDir.split('/').filter(Boolean) : []
  const to = targetPath.split('/').filter(Boolean)

  // 最后一段是文件名，不参与目录层级的比对
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) {
    common += 1
  }

  const up = from.length - common
  return [...Array.from({ length: up }, () => '..'), ...to.slice(common)].join('/')
}

export type EntryKind = 'note' | 'folder'

export type EntryNameResult =
  | { ok: true; finalName: string }
  | { ok: false; message: string }

/** Windows 上非法的文件名字符；笔记会同步到 Git 仓库并可能在其他平台检出，因此统一拒绝 */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/

/** Windows 保留设备名，同样会导致在其他平台检出失败 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 笔记统一使用 .md；已带 Markdown 扩展名则保持原样 */
function withNoteExtension(name: string): string {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') ? name : `${name}.md`
}

/**
 * 校验新建文件/文件夹的名称。
 *
 * 刻意按最严格的平台规则校验（而非仅在 Windows 上生效）：笔记库会通过 Git 同步，
 * 在此处放行的名字可能让其他机器上的检出失败，代价远高于提前拒绝。
 */
export function checkEntryName(raw: string, kind: EntryKind): EntryNameResult {
  const name = raw.trim()

  if (!name) return { ok: false, message: '名称不能为空' }

  if (name.startsWith('.')) {
    return { ok: false, message: '名称不能以点开头，这类文件不会出现在笔记列表中' }
  }

  if (INVALID_NAME_CHARS.test(name)) {
    return { ok: false, message: '名称不能包含 \\ / : * ? " < > | 这些字符' }
  }

  if (WINDOWS_RESERVED_NAME.test(name)) {
    return { ok: false, message: `“${name}” 是系统保留名称，请换一个` }
  }

  return { ok: true, finalName: kind === 'note' ? withNoteExtension(name) : name }
}
