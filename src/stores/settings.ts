import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'light' | 'dark'

interface SettingsState {
  theme: ThemePref
  /** Minutes of inactivity before the app locks (only with a passcode). 0 = never. */
  autoLockMinutes: number
  /** Encrypt every upload, not just those into encrypted folders. */
  encryptAll: boolean
  /** Remove the TeleDriver tag line from captions when forwarding. */
  cleanForward: boolean
  uploadConcurrency: number
  setTheme: (t: ThemePref) => void
  set: (patch: Partial<Omit<SettingsState, 'set' | 'setTheme'>>) => void
}

const THEME_KEY = 'td-theme'

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: readTheme(),
      autoLockMinutes: 15,
      encryptAll: false,
      cleanForward: true,
      uploadConcurrency: 2,
      setTheme: (theme) => {
        try {
          localStorage.setItem(THEME_KEY, theme)
        } catch {
          /* ignore */
        }
        applyTheme(theme)
        set({ theme })
      },
      set: (patch) => set(patch),
    }),
    {
      name: 'td-settings',
      partialize: (s) => ({
        autoLockMinutes: s.autoLockMinutes,
        encryptAll: s.encryptAll,
        cleanForward: s.cleanForward,
        uploadConcurrency: s.uploadConcurrency,
      }),
    },
  ),
)

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useSettings.getState().theme === 'system') applyTheme('system')
  })
}
