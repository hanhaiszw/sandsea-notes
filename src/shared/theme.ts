/**
 * 主题契约（方案 §5.5）。
 *
 * 本文件同时被主进程与渲染进程引用，不得引入 Node 或 DOM 专有 API。
 */

/** 用户可见的三种选择：跟随系统 / 白天 / 黑夜 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 实际用于渲染的主题（'system' 会被解析成其中之一） */
export type ResolvedTheme = 'light' | 'dark'

export const DEFAULT_THEME_MODE: ThemeMode = 'system'

const MODE_ORDER: ThemeMode[] = ['system', 'light', 'dark']

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '白天',
  dark: '黑夜'
}

/** 菜单里循环切换时使用：跟随系统 → 白天 → 黑夜 → 跟随系统 */
export function nextThemeMode(current: ThemeMode): ThemeMode {
  const index = MODE_ORDER.indexOf(current)
  return MODE_ORDER[(index + 1) % MODE_ORDER.length]
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODE_ORDER as string[]).includes(value)
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

/**
 * 窗口底色：渲染进程绘制前会先显示它，必须与主题一致，否则启动或缩放窗口时会闪错色。
 * 取值需与 global.css 里对应主题的 --ink-900 保持一致。
 */
export const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: '#14161a',
  light: '#e9ebed'
}

/** 界面偏好（跨进程读写的最小集合） */
export interface Preferences {
  theme: ThemeMode
}
