import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Megaphone, Plus, Search, Sparkles, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { logout, selectStorage } from '@/app/session'
import { foldText } from '@/lib/utils'
import { reportError } from '@/lib/uiErrors'
import { useApp } from '@/stores/app'
import { ensureConnected } from '@/telegram/client'
import { chatKeyOf, createStorageChannel, listStorageOptions, type StorageOption, type StorageRef } from '@/telegram/peers'
import { AuthShell, Card } from './auth/AuthShell'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Spinner } from './ui/misc'

export function StoragePicker() {
  const { t } = useTranslation()
  const current = useApp((s) => s.storage)
  const hadStorage = !!current
  const [options, setOptions] = useState<StorageOption[] | null>(null)
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('TeleDriver Storage')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ensureConnected()
      .then(listStorageOptions)
      .then((o) => alive && setOptions(o))
      .catch((err) => {
        reportError(err)
        if (alive) setOptions([])
      })
    return () => {
      alive = false
    }
  }, [])

  const filtered = useMemo(() => {
    const q = foldText(query)
    return (options ?? []).filter((o) => !q || foldText(o.ref.title).includes(q))
  }, [options, query])

  const choose = async (key: string, get: () => Promise<StorageRef> | StorageRef) => {
    setBusy(key)
    try {
      await selectStorage(await get())
    } catch (err) {
      reportError(err)
      setBusy(null)
    }
  }

  const isCurrent = (ref: StorageRef) => current && chatKeyOf(current) === chatKeyOf(ref)

  return (
    <AuthShell wide>
      <Card>
        <h1 className="text-xl font-semibold">{t('storage.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('storage.subtitle')}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4 text-primary" />
              {t('storage.createTitle')}
              <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t('storage.recommended')}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t('storage.createDesc')}</p>
            <div className="mt-auto flex gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} aria-label={t('storage.channelName')} />
              <Button
                disabled={!title.trim() || !!busy}
                onClick={() => void choose('create', () => createStorageChannel(title.trim(), t('storage.channelAbout')))}
              >
                {busy === 'create' ? <Spinner /> : <Plus />}
                {t('storage.create')}
              </Button>
            </div>
          </div>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void choose('self', () => ({ kind: 'self', title: 'Saved Messages' }))}
            className="flex flex-col gap-3 rounded-xl border p-4 text-left transition hover:border-primary/50 hover:bg-accent/50 disabled:opacity-60"
          >
            <div className="flex items-center gap-2 font-medium">
              <Bookmark className="size-4 text-sky-500" />
              {t('storage.saved')}
              {busy === 'self' && <Spinner className="ml-auto" />}
            </div>
            <p className="text-sm text-muted-foreground">{t('storage.savedDesc')}</p>
          </button>
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <h2 className="font-medium">{t('storage.existing')}</h2>
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border scrollbar-thin">
          {options === null ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Spinner /> {t('storage.loading')}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t('storage.none')}</p>
          ) : (
            filtered.map((o) => {
              const key = chatKeyOf(o.ref)
              const Icon = o.kind === 'channel' ? Megaphone : Users
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!busy}
                  onClick={() => void choose(key, () => o.ref)}
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition last:border-b-0 hover:bg-accent/60 disabled:opacity-60"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.ref.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(o.kind === 'channel' ? 'storage.channel' : 'storage.group')}
                      {o.members ? ` · ${t('storage.members', { count: o.members })}` : ''}
                    </div>
                  </div>
                  {isCurrent(o.ref) && <span className="text-xs font-medium text-primary">{t('storage.current')}</span>}
                  {busy === key && <Spinner />}
                </button>
              )
            })
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('storage.groupNote')}</p>

        <div className="mt-6 flex justify-between border-t pt-4">
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t('account.logout')}
          </Button>
          {hadStorage && (
            <Button variant="outline" size="sm" onClick={() => useApp.setState({ phase: 'ready' })}>
              {t('common.back')}
            </Button>
          )}
        </div>
      </Card>
    </AuthShell>
  )
}
