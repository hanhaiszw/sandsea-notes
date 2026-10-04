import Store from 'electron-store'

import type { GitConfig } from '@shared/git'
import { DEFAULT_IGNORED_DIRS } from '@shared/notes'
import { DEFAULT_THEME_MODE, isThemeMode, type Preferences, type ThemeMode } from '@shared/theme'

/** 主进程侧的持久化配置（方案 §5.5） */
export interface AppConfig {
  /** 当前笔记库绝对路径，未选择时为 null */
  vaultRoot: string | null
  /** 最近使用过的笔记库，用于快速切换 */
  recentVaults: string[]
  /** 扫描与监听时需要跳过的目录名 */
  ignoredDirNames: string[]
  /** Git 同步配置（不含凭证，凭证单独加密存放） */
  git: GitConfig
  /** 界面主题：跟随系统 / 白天 / 黑夜 */
  theme: ThemeMode
}

function defaultAuthorName(): string {
  return process.env['USER'] ?? process.env['USERNAME'] ?? 'notes'
}

/**
 * 提交必须带上邮箱，git 才会生成 commit。用户没填过时给一个本机占位地址，
 * 免得「打开笔记库就能记历史」这条主线卡在一个必填项上。
 * 设置里随时能改成常用邮箱 —— 推送到 GitHub / Gitee 前建议改掉。
 */
function defaultAuthorEmail(): string {
  return `${defaultAuthorName()}@localhost`
}

export const DEFAULT_GIT_CONFIG: GitConfig = {
  backend: 'isomorphic',
  remoteUrl: '',
  branch: 'main',
  username: '',
  author: { name: defaultAuthorName(), email: defaultAuthorEmail() }
}

const DEFAULTS: AppConfig = {
  vaultRoot: null,
  recentVaults: [],
  ignoredDirNames: [...DEFAULT_IGNORED_DIRS],
  git: DEFAULT_GIT_CONFIG,
  theme: DEFAULT_THEME_MODE
}

/**
 * 延迟到首次使用时再创建。
 * electron-store 在构造时就会读写 userData 目录，而应用名与 userData 路径需要在
 * app ready 之前显式设置，因此不能在这里于模块加载阶段就实例化。
 */
let storeInstance: Store<AppConfig> | null = null

function store(): Store<AppConfig> {
  storeInstance ??= new Store<AppConfig>({ name: 'config', defaults: DEFAULTS })
  return storeInstance
}

export const config = {
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return store().get(key)
  },
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    store().set(key, value)
  }
}

/**
 * 读取 Git 配置并与默认值逐层合并。
 * 配置文件可能来自旧版本或被手工编辑，缺字段时不能把 undefined 漏给上层。
 */
export function readGitConfig(): GitConfig {
  const stored = config.get('git')
  return {
    ...DEFAULT_GIT_CONFIG,
    ...stored,
    // 署名的空值也要当缺省处理：旧版本的默认邮箱就是空串，
    // 空着会让 git 直接拒绝生成提交
    author: {
      name: stored?.author?.name?.trim() || DEFAULT_GIT_CONFIG.author.name,
      email: stored?.author?.email?.trim() || DEFAULT_GIT_CONFIG.author.email
    }
  }
}

export function writeGitConfig(value: GitConfig): void {
  config.set('git', value)
}

/** 界面偏好（与 Git 配置分开，便于后续继续添加） */
export function readPreferences(): Preferences {
  const stored = config.get('theme')
  return { theme: isThemeMode(stored) ? stored : DEFAULT_THEME_MODE }
}

export function writePreferences(next: Partial<Preferences>): Preferences {
  if (isThemeMode(next.theme)) config.set('theme', next.theme)
  return readPreferences()
}
