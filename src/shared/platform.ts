/**
 * 跨平台基座（方案 §3.4）。
 *
 * v1 只发布 macOS，但所有平台相关的差异都必须经由本模块判断，
 * 禁止在业务代码里直接写 `process.platform === 'darwin'`。
 */

export type PlatformId = 'darwin' | 'win32' | 'linux' | 'other'

/** 结构化描述一次按键事件中的修饰键状态，避免依赖 DOM 的 KeyboardEvent 类型 */
export interface ModifierKeyState {
  metaKey: boolean
  ctrlKey: boolean
}

export function toPlatformId(raw: string): PlatformId {
  return raw === 'darwin' || raw === 'win32' || raw === 'linux' ? raw : 'other'
}

export function isMac(platform: PlatformId): boolean {
  return platform === 'darwin'
}

/** 修饰键显示文案：macOS 用 ⌘，其余平台用 Ctrl */
export function formatShortcut(platform: PlatformId, key: string): string {
  return isMac(platform) ? `⌘${key}` : `Ctrl+${key}`
}

/**
 * 判断主修饰键是否按下。
 * 之所以抽成函数而不是散落的 metaKey 判断，是为了让快捷键逻辑在 Windows 上零改动可用。
 */
export function isModifierPressed(platform: PlatformId, event: ModifierKeyState): boolean {
  return isMac(platform) ? event.metaKey : event.ctrlKey
}
