import { useEffect, useRef } from 'react'
import { CloudOff, KeyRound, Lock, LogOut, Menu, RefreshCw, Search, Settings, Shuffle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { chooseAnotherStorage, lockApp, logout, refreshDrive } from '@/app/session'
import { reportError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { Logo, ThemeToggle } from '../common'
import { Button } from '../ui/button'
import { ActionDropdown, type MenuAction } from '../ui/menu'
import { Spinner, Tip } from '../ui/misc'

function SearchBox() {
  const { t } = useTranslation()
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(target.tagName) && !target.isContentEditable) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative w-full max-w-2xl">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        id="td-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSearch('')
            ref.current?.blur()
          }
        }}
        placeholder={t('topbar.search')}
        className="h-11 w-full rounded-full border border-transparent bg-secondary pr-10 pl-11 text-sm transition outline-none placeholder:text-muted-foreground focus:border-ring/40 focus:bg-background focus:shadow-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {search && (
        <button
          type="button"
          aria-label={t('common.clear')}
          onClick={() => setSearch('')}
          className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

function Status() {
  const { t } = useTranslation()
  const conn = useApp((s) => s.conn)
  const sync = useApp((s) => s.sync)
  const refresh = () => refreshDrive(true).catch((err) => reportError(err, t('topbar.syncFailed')))
  if (conn !== 'connected') {
    return (
      <Tip label={conn === 'connecting' ? t('topbar.connecting') : t('topbar.offline')}>
        <span className="grid size-9 place-items-center text-warning">{conn === 'connecting' ? <Spinner /> : <CloudOff className="size-4" />}</span>
      </Tip>
    )
  }
  return (
    <Tip label={sync.running ? t('topbar.syncing', { count: sync.scanned }) : sync.error ? t('topbar.syncError', { error: sync.error }) : t('topbar.refresh')}>
      <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={sync.running} aria-label={t('topbar.refresh')}>
        <RefreshCw className={cn(sync.running && 'animate-spin', sync.error && 'text-destructive')} />
      </Button>
    </Tip>
  )
}

function Account() {
  const { t } = useTranslation()
  const me = useApp((s) => s.me)
  const passcode = useApp((s) => s.passcodeEnabled)
  const openDialog = useUi((s) => s.openDialog)
  if (!me) return null
  const initials = (me.firstName || me.username || '?').slice(0, 1).toUpperCase()
  const actions: MenuAction[] = [
    { key: 'storage', label: t('topbar.switchStorage'), icon: <Shuffle />, onSelect: chooseAnotherStorage },
    { key: 'security', label: t('settings.security'), icon: <KeyRound />, onSelect: () => openDialog({ kind: 'settings', tab: 'security' }) },
  ]
  if (passcode) actions.push({ key: 'lock', label: t('topbar.lockNow'), icon: <Lock />, onSelect: () => void lockApp() })
  actions.push({ key: 'logout', label: t('account.logout'), icon: <LogOut />, danger: true, separatorBefore: true, onSelect: () => void logout() })
  return (
    <ActionDropdown actions={actions}>
      <button type="button" className="flex items-center gap-2 rounded-full p-1 transition hover:bg-accent" aria-label={t('topbar.account')}>
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-semibold text-white">{initials}</span>
        <span className="hidden max-w-32 truncate pr-2 text-sm font-medium lg:block">{me.firstName}</span>
      </button>
    </ActionDropdown>
  )
}

export function Topbar() {
  const { t } = useTranslation()
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const openDialog = useUi((s) => s.openDialog)
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:gap-4 sm:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t('topbar.menu')}>
        <Menu />
      </Button>
      <div className="hidden w-[232px] shrink-0 items-center gap-2.5 pl-2 md:flex">
        <Logo className="size-9" />
        <span className="text-xl font-semibold tracking-tight">TeleDriver</span>
      </div>
      <SearchBox />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Status />
        <span className="hidden sm:block">
          <ThemeToggle />
        </span>
        <Tip label={t('settings.title')}>
          <Button variant="ghost" size="icon" onClick={() => openDialog({ kind: 'settings' })} aria-label={t('settings.title')}>
            <Settings />
          </Button>
        </Tip>
        <Account />
      </div>
    </header>
  )
}
