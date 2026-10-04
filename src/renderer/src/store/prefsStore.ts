import { create } from 'zustand'

import {
  DEFAULT_THEME_MODE,
  THEME_MODE_LABEL,
  nextThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode
} from '@shared/theme'

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = resolved
}

interface PrefsStore {
  /** 用户的显式选择（可能是「跟随系统」） */
  theme: ThemeMode
  /** 实际渲染用到的主题 */
  resolved: ResolvedTheme
  label: string
  load: () => Promise<void>
  cycleTheme: () => Promise<void>
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  theme: DEFAULT_THEME_MODE,
  resolved: resolveTheme(DEFAULT_THEME_MODE, systemPrefersDark.matches),
  label: THEME_MODE_LABEL[DEFAULT_THEME_MODE],

  load: async () => {
    const result = await window.notes.prefs.get()
    const theme = result.ok ? result.data.theme : DEFAULT_THEME_MODE
    const resolved = resolveTheme(theme, systemPrefersDark.matches)
    applyTheme(resolved)
    set({ theme, resolved, label: THEME_MODE_LABEL[theme] })
  },

  cycleTheme: async () => {
    const next = nextThemeMode(get().theme)
    const resolved = resolveTheme(next, systemPrefersDark.matches)

    // 先落界面再落盘：切换主题应当立即生效，不该等 IPC 往返
    applyTheme(resolved)
    set({ theme: next, resolved, label: THEME_MODE_LABEL[next] })

    const result = await window.notes.prefs.set({ theme: next })
    if (!result.ok) return
    set({ theme: result.data.theme, label: THEME_MODE_LABEL[result.data.theme] })
  }
}))

// 「跟随系统」时，系统在深浅之间切换要实时跟上
systemPrefersDark.addEventListener('change', () => {
  if (usePrefsStore.getState().theme !== 'system') return
  const resolved = resolveTheme('system', systemPrefersDark.matches)
  applyTheme(resolved)
  usePrefsStore.setState({ resolved })
})
