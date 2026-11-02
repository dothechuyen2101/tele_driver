import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Bot, Check, Megaphone, Search, TriangleAlert, User, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { forwardFiles, type ForwardMode } from '@/drive/forward'
import type { DriveFile } from '@/drive/model'
import { foldText, cn } from '@/lib/utils'
import { describeError, reportError } from '@/lib/uiErrors'
import { useSettings } from '@/stores/settings'
import { ensureConnected } from '@/telegram/client'
import { listChatTargets, type ChatTarget } from '@/telegram/peers'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../ui/dialog'
import { Input } from '../ui/input'
import { Spinner } from '../ui/misc'

const KIND_ICON = { self: Bookmark, user: User, bot: Bot, group: Users, channel: Megaphone }

export function ForwardDialog({ files, onClose }: { files: DriveFile[]; onClose: () => void }) {
  const { t } = useTranslation()
  const cleanDefault = useSettings((s) => s.cleanForward)
  const [targets, setTargets] = useState<ChatTarget[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<ForwardMode>('copy')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const encrypted = files.some((f) => f.enc)
  const incomplete = files.some((f) => !f.complete)

  useEffect(() => {
    let alive = true
    ensureConnected()
      .then(listChatTargets)
      .then((list) => alive && setTargets(list))
      .catch((err) => {
        if (alive) setError(describeError(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const visible = useMemo(() => {
    const q = foldText(query)
    return (targets ?? []).filter((c) => !q || foldText(c.title).includes(q) || (c.username && foldText(c.username).includes(q)))
  }, [targets, query])

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const send = async () => {
    const chosen = (targets ?? []).filter((c) => picked.has(c.key))
    setBusy(true)
    try {
      await forwardFiles(files, chosen, mode, cleanDefault)
      toast.success(t('forward.sent', { count: files.length, chats: chosen.length }))
      onClose()
    } catch (err) {
      reportError(err, t('forward.failed'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader title={t('forward.title', { count: files.length })} />
        {(encrypted || incomplete) && (
          <p className="flex gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs">
            <TriangleAlert className="size-4 shrink-0 text-warning" />
            {encrypted ? t('forward.encryptedWarning') : t('forward.incompleteWarning')}
          </p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t('forward.search')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="h-64 overflow-y-auto rounded-lg border scrollbar-thin">
          {error ? (
            <p className="p-6 text-center text-sm text-destructive">{error}</p>
          ) : targets === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            visible.map((c) => {
              const Icon = KIND_ICON[c.kind]
              const on = picked.has(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggle(c.key)}
                  className={cn('flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent', on && 'bg-selection')}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.kind === 'self' ? t('storage.saved') : c.title}</span>
                    {c.username && <span className="block truncate text-xs text-muted-foreground">@{c.username}</span>}
                  </span>
                  <span className={cn('grid size-5 place-items-center rounded-full border-2', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['copy', 'forward'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn('rounded-lg border p-2.5 text-left transition', mode === m ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
            >
              <span className="block text-sm font-medium">{t(`forward.mode.${m}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`forward.mode.${m}Hint`)}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void send()} disabled={!picked.size || busy || incomplete}>
            {busy && <Spinner />}
            {t('forward.send', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
