import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Bot, FileText, Film, Headphones, Image, Link2, Megaphone, Search, ShieldAlert, User, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { withVault } from '@/app/actions'
import { createImport } from '@/drive/imports/runner'
import { followChat, scanItemToImport } from '@/drive/imports/subscriptions'
import { isStorageChat, MEDIA_KINDS, scanChat, type MediaKind, type ScanItem } from '@/drive/imports/telegram'
import { needsEncryption } from '@/drive/uploads'
import { useCurrentFolderId } from '@/hooks/useView'
import { describeError, reportError } from '@/lib/uiErrors'
import { cn, foldText, isAbortError } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { ensureConnected } from '@/telegram/client'
import { getHistoryPage } from '@/telegram/messages'
import { accessHashOf, chatKeyOf, listSourceChats, parsePeerLink, resolvePeerLink, type SourceChat } from '@/telegram/peers'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Progress, Spinner, Switch } from '../ui/misc'
import { resolveTarget, type TargetState } from './helpers'
import { FolderTarget, PickList, SelectionBar, type PickRow } from './shared'

const CHAT_ICON = { self: Bookmark, user: User, bot: Bot, group: Users, channel: Megaphone }
const KIND_ICON: Record<MediaKind, typeof FileText> = { d: FileText, p: Image, v: Film, a: Headphones }

function ChatChooser({ onPick }: { onPick: (c: SourceChat) => void }) {
  const { t } = useTranslation()
  const [chats, setChats] = useState<SourceChat[] | null>(null)
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    let alive = true
    ensureConnected()
      .then(listSourceChats)
      .then((list) => alive && setChats(list.filter((c) => !isStorageChat(c.ref))))
      .catch((err) => alive && setError(describeError(err)))
    return () => {
      alive = false
    }
  }, [])

  const visible = useMemo(() => {
    const q = foldText(query.replace(/^@/, ''))
    return (chats ?? []).filter((c) => !q || foldText(c.ref.title).includes(q) || (c.username && foldText(c.username).includes(q)))
  }, [chats, query])
  const looksLikeLink = /t\.me\/|telegram\.(me|dog)\/|^@/i.test(query.trim()) && !!parsePeerLink(query)

  const open = async () => {
    setResolving(true)
    try {
      const chat = await resolvePeerLink(query)
      if (isStorageChat(chat.ref)) throw new Error('SAME_AS_STORAGE')
      onPick(chat)
    } catch (err) {
      reportError(err)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('imports.tg.chooseHint')}</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t('imports.tg.searchOrLink')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        {looksLikeLink && (
          <Button onClick={() => void open()} disabled={resolving}>
            {resolving ? <Spinner /> : <Link2 />}
            {t('imports.tg.openLink')}
          </Button>
        )}
      </div>
      <div className="max-h-[50vh] min-h-48 overflow-y-auto rounded-lg border scrollbar-thin">
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">{error}</p>
        ) : chats === null ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('imports.tg.noChats')}</p>
        ) : (
          visible.map((c) => {
            const Icon = CHAT_ICON[c.kind]
            return (
              <button
                key={chatKeyOf(c.ref)}
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.kind === 'self' ? t('storage.saved') : c.ref.title}</span>
                  {c.username && <span className="block truncate text-xs text-muted-foreground">@{c.username}</span>}
                </span>
                {c.protected && (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <ShieldAlert className="size-3.5" />
                    {t('imports.tg.protected')}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

type Scan = { status: 'idle' | 'scanning' | 'done' | 'error'; found: number; total: number; items: ScanItem[]; error?: string }

const toUnix = (date: string, endOfDay = false) => Math.floor(new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime() / 1000)

function ScanAndImport({ source, onBack, onStarted }: { source: SourceChat; onBack: () => void; onStarted: () => void }) {
  const { t } = useTranslation()
  const sources = useDrive((s) => s.index.sources)
  const currentFolder = useCurrentFolderId()
  const [kinds, setKinds] = useState<Set<MediaKind>>(new Set(MEDIA_KINDS))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [scan, setScan] = useState<Scan>({ status: 'idle', found: 0, total: 0, items: [] })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<TargetState>({ parentId: currentFolder, createSub: true, subfolder: source.ref.title })
  const [keepCaptions, setKeepCaptions] = useState(true)
  const [follow, setFollow] = useState(false)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runScan = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setScan({ status: 'scanning', found: 0, total: 0, items: [] })
    try {
      const items = await scanChat(source.ref, {
        kinds: [...kinds],
        from: from ? toUnix(from) : undefined,
        to: to ? toUnix(to, true) : undefined,
        signal: ac.signal,
        onProgress: (found, total) => setScan((s) => ({ ...s, found, total })),
      })
      setScan({ status: 'done', found: items.length, total: items.length, items })
      setSelected(new Set(items.filter((i) => !sources.has(i.key)).map((i) => i.key)))
    } catch (err) {
      if (!isAbortError(err)) setScan((s) => ({ ...s, status: 'error', error: describeError(err) }))
    }
  }

  const rows: PickRow[] = useMemo(
    () =>
      scan.items.map((i) => {
        const Icon = KIND_ICON[i.kind]
        const already = sources.has(i.key)
        return { key: i.key, name: i.name, size: i.size, date: i.date, icon: <Icon className="text-muted-foreground" />, note: already ? t('imports.alreadyIn') : undefined, disabled: already }
      }),
    [scan.items, sources, t],
  )
  const chosen = scan.items.filter((i) => selected.has(i.key))
  const chosenSize = chosen.reduce((n, i) => n + i.size, 0)

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const start = () => {
    const run = async () => {
      setBusy(true)
      try {
        const folderId = await resolveTarget(target)
        if (chosen.length) {
          await createImport(
            {
              kind: 'tg',
              title: source.ref.title,
              folderId,
              encrypt: needsEncryption(folderId),
              keepCaptions,
              peer: { key: chatKeyOf(source.ref), accessHash: accessHashOf(source.ref), title: source.ref.title },
            },
            chosen.map(scanItemToImport),
          )
        }
        if (follow) {
          // Follow from the newest message, so only posts made from now on are added.
          const { messages } = await getHistoryPage(source.ref, { limit: 1 })
          await followChat(source, folderId, [...kinds].join(''), messages[0]?.id ?? 0)
        }
        toast.success(follow && !chosen.length ? t('imports.tg.followed') : t('imports.started', { count: chosen.length }))
        onStarted()
      } catch (err) {
        reportError(err)
      } finally {
        setBusy(false)
      }
    }
    if (needsEncryption(target.parentId)) withVault(run)
    else void run()
  }

  const canFollow = source.kind !== 'self'

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <div className="truncate font-medium">{source.kind === 'self' ? t('storage.saved') : source.ref.title}</div>
          {source.username && <div className="text-xs text-muted-foreground">@{source.username}</div>}
        </div>
      </div>

      {source.protected && (
        <p className="flex gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm">
          <ShieldAlert className="size-4 shrink-0 text-warning" />
          {t('imports.tg.protectedWarning')}
        </p>
      )}

      <div className="grid gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap gap-2">
          {MEDIA_KINDS.map((k) => {
            const Icon = KIND_ICON[k]
            const on = kinds.has(k)
            return (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setKinds((prev) => {
                    const next = new Set(prev)
                    if (next.has(k)) next.delete(k)
                    else next.add(k)
                    return next
                  })
                }
                className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition', on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent')}
              >
                <Icon className="size-4" />
                {t(`imports.kinds.${k}`)}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('imports.from')}
            <Input type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('imports.to')}
            <Input type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button onClick={() => void runScan()} disabled={!kinds.size || scan.status === 'scanning'}>
            {scan.status === 'scanning' ? <Spinner /> : <Search />}
            {t('imports.tg.scan')}
          </Button>
        </div>
        {scan.status === 'scanning' && (
          <div className="grid gap-1.5">
            <Progress value={scan.total ? (scan.found / scan.total) * 100 : 0} indeterminate={!scan.total} />
            <span className="text-xs text-muted-foreground">{t('imports.tg.scanning', { found: scan.found, total: scan.total || '?' })}</span>
          </div>
        )}
        {scan.status === 'error' && <p className="text-sm text-destructive">{scan.error}</p>}
      </div>

      {scan.status === 'done' && (
        <>
          {scan.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('imports.tg.nothingFound')}</p>
          ) : (
            <div className="grid gap-2">
              <SelectionBar
                total={scan.items.length}
                selected={chosen.length}
                size={chosenSize}
                onAll={() => setSelected(new Set(scan.items.filter((i) => !sources.has(i.key)).map((i) => i.key)))}
                onNone={() => setSelected(new Set())}
              />
              <PickList rows={rows} selected={selected} onToggle={toggle} />
            </div>
          )}
          <FolderTarget value={target} onChange={setTarget} />
          <div className="grid gap-3">
            <label className="flex items-start justify-between gap-4 text-sm">
              <span>
                {t('imports.tg.keepCaptions')}
                <span className="block text-xs text-muted-foreground">{t('imports.tg.keepCaptionsHint')}</span>
              </span>
              <Switch checked={keepCaptions} onCheckedChange={setKeepCaptions} />
            </label>
            {canFollow && (
              <label className="flex items-start justify-between gap-4 text-sm">
                <span>
                  {t('imports.tg.follow')}
                  <span className="block text-xs text-muted-foreground">{t('imports.tg.followHint')}</span>
                </span>
                <Switch checked={follow} onCheckedChange={setFollow} />
              </label>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="lg" onClick={start} disabled={busy || (!chosen.length && !follow) || source.protected}>
              {busy && <Spinner />}
              {chosen.length ? t('imports.importCount', { count: chosen.length }) : t('imports.tg.followOnly')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function TelegramImport({ onStarted }: { onStarted: () => void }) {
  const [source, setSource] = useState<SourceChat | null>(null)
  return source ? <ScanAndImport key={chatKeyOf(source.ref)} source={source} onBack={() => setSource(null)} onStarted={onStarted} /> : <ChatChooser onPick={setSource} />
}
