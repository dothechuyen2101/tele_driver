import { Languages, Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { languagePreference, setLanguage, type Language } from '@/i18n'
import { useSettings, type ThemePref } from '@/stores/settings'
import { Button } from './ui/button'
import { ActionDropdown } from './ui/menu'
import { Tip } from './ui/misc'

export function Logo({ className = 'size-8' }: { className?: string }) {
  return <img src="/icons/icon.svg" alt="" className={className} draggable={false} />
}

const THEME_ICON: Record<ThemePref, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

export function ThemeToggle() {
  const { t } = useTranslation()
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const Icon = THEME_ICON[theme]
  const prefs: ThemePref[] = ['system', 'light', 'dark']
  return (
    <ActionDropdown
      actions={prefs.map((p) => {
        const I = THEME_ICON[p]
        return { key: p, label: t(`theme.${p}`) + (p === theme ? ' ✓' : ''), icon: <I />, onSelect: () => setTheme(p) }
      })}
    >
      <Button variant="ghost" size="icon" aria-label={t('theme.title')}>
        <Icon />
      </Button>
    </ActionDropdown>
  )
}

export function LanguageMenu() {
  const { t } = useTranslation()
  const current = languagePreference()
  const options: (Language | 'auto')[] = ['auto', 'vi', 'en']
  return (
    <ActionDropdown
      actions={options.map((o) => ({
        key: o,
        label: t(`language.${o}`) + (o === current ? ' ✓' : ''),
        onSelect: () => setLanguage(o),
      }))}
    >
      <Button variant="ghost" size="icon" aria-label={t('language.title')}>
        <Languages />
      </Button>
    </ActionDropdown>
  )
}

export function PreferenceButtons() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1">
      <Tip label={t('language.title')}>
        <span>
          <LanguageMenu />
        </span>
      </Tip>
      <ThemeToggle />
    </div>
  )
}
