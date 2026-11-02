import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CircleCheck, FileText, FolderOpen, FolderSync, HardDriveDownload, LogOut, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { withVault } from '@/app/actions'
import { createImport } from '@/drive/imports/runner'
import { followDriveFolder } from '@/drive/imports/subscriptions'
import { ensureFolder } from '@/drive/ops'
import { needsEncryption } from '@/drive/uploads'
import { disconnectGoogle, ensureToken, GIS_SRC, googleConfig, loadScript, useGoogle } from '@/google/auth'
import { getMeta, listTree, toEntry, type DriveEntry } from '@/google/drive'
import { pick, preloadPicker } from '@/google/picker'
import { reportError } from '@/lib/uiErrors'
import { mapLimit } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { useSettings } from '@/stores/settings'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Progress, Spinner, Switch } from '../ui/misc'
import { reasonLabel, resolveTarget, type TargetState } from './helpers'
import { FolderTarget, PickList, SelectionBar, type PickRow } from './shared'

function GoogleSetup({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const current = useSettings((s) => s.google)
  const set = useSettings((s) => s.set)
  const [clientId, setClientId] = useState(current?.clientId ?? '')
  const [apiKey, setApiKey] = useState(current?.apiKey ?? '')
  const [appId, setAppId] = useState(current?.appId ?? '')
  const save = (e: FormEvent) => {
    e.preventDefault()
    set({ google: { clientId: clientId.trim(), apiKey: apiKey.trim(), appId: appId.trim() } })
    onDone?.()
  }
  const steps = ['step1', 'step2', 'step3', 'step4']
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="grid content-start gap-3 text-sm">
        <h3 className="font-semibold">{t('imports.gd.setupTitle')}</h3>
        <ol className="grid list-decimal gap-2 pl-5 text-muted-foreground">
          {steps.map((s) => (
            <li key={s}>{t(`imports.gd.${s}`, { origin: location.origin })}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{t('imports.gd.envHint')}</p>
      </div>
      <form onSubmit={save} className="grid content-start gap-3">
        <label className="grid gap-1 text-sm">
          OAuth Client ID
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" spellCheck={false} />
        </label>
        <label className="grid gap-1 text-sm">
          API key
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" spellCheck={false} />
        </label>
        <label className="grid gap-1 text-sm">
          {t('imports.gd.projectNumber')}
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456789012" inputMode="numeric" />
        </label>
        <Button type="submit" disabled={!clientId.trim() || !apiKey.trim() || !appId.trim()}>
          {t('common.save')}
        </Button>
      </form>
    </div>
  )
}

type Picked = { mode: 'files' | 'folder'; folders: { id: string; name: string }[]; entries: DriveEntry[] }

export function GoogleImport({ onStarted }: { onStarted: () => void }) {
  const { t } = useTranslation()
  // Subscribing re-renders when the override changes; the env part never changes.
  useSettings((s) => s.google)
  const configured = !!googleConfig()
  const [editing, setEditing] = useState(false)
  const token = useGoogle((s) => s.token)
  const sources = useDrive((s) => s.index.sources)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [listing, setListing] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<TargetState>({ parentId: 0, createSub: false, subfolder: 'Google Drive' })
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)

  // Load Google's scripts ahead, so the consent popup opens straight from the click.
  useEffect(() => {
    if (!configured) return
    void loadScript(GIS_SRC).catch(() => {})
    void preloadPicker().catch(() => {})
  }, [configured])

  const accept = (p: Picked) => {
    setPicked(p)
    setSelected(new Set(p.entries.filter((e) => !e.skip && !sources.has(`gd:${e.fileId}`)).map((e) => e.fileId)))
  }

  const pickFiles = async () => {
    try {
      const tok = await ensureToken('file')
      const docs = await pick(tok, 'files')
      if (!docs.length) return
      setListing(0)
      const metas = await mapLimit(docs, 4, (d) => getMeta(d.id, tok))
      accept({ mode: 'files', folders: [], entries: metas.map((m) => toEntry(m, '')) })
    } catch (err) {
      reportError(err)
    } finally {
      setListing(null)
    }
  }

  const pickFolder = async () => {
    try {
      const tok = await ensureToken('readonly')
      const docs = await pick(tok, 'folder')
      if (!docs.length) return
      setListing(0)
      const entries: DriveEntry[] = []
      for (const f of docs) {
        const list = await listTree(f.id, tok, { onProgress: (n) => setListing(entries.length + n) })
        entries.push(...list.map((e) => ({ ...e, dir: e.dir ? `${f.name}/${e.dir}` : f.name })))
      }
      accept({ mode: 'folder', folders: docs.map((d) => ({ id: d.id, name: d.name })), entries })
    } catch (err) {
      reportError(err)
    } finally {
      setListing(null)
    }
  }

  const rows: PickRow[] = useMemo(
    () =>
      (picked?.entries ?? []).map((e) => {
        const already = sources.has(`gd:${e.fileId}`)
        return {
          key: e.fileId,
          name: e.dir ? `${e.dir}/${e.name}` : e.name,
          size: e.size,
          icon: <FileText className="text-muted-foreground" />,
          note: e.skip ? reasonLabel(e.skip) : already ? t('imports.alreadyIn') : e.exportMime ? t('imports.gd.willExport') : undefined,
          disabled: !!e.skip || already,
        }
      }),
    [picked, sources, t],
  )
  const chosen = (picked?.entries ?? []).filter((e) => selected.has(e.fileId))
  const chosenSize = chosen.reduce((n, e) => n + Math.max(0, e.size), 0)

  const start = () => {
    if (!picked) return
    const run = async () => {
      setBusy(true)
      try {
        const folderId = await resolveTarget(target)
        const title = picked.mode === 'folder' ? picked.folders.map((f) => f.name).join(', ') : t('imports.gd.filesTitle', { count: chosen.length })
        await createImport(
          { kind: 'gd', title, folderId, encrypt: needsEncryption(folderId), keepCaptions: false },
          chosen.map((e) => ({ key: `gd:${e.fileId}`, name: e.name, size: e.size, mime: e.mime, fileId: e.fileId, exportMime: e.exportMime, dir: e.dir })),
        )
        if (picked.mode === 'folder' && remember) {
          for (const f of picked.folders) await followDriveFolder(f.id, f.name, await ensureFolder(folderId, f.name))
        }
        toast.success(t('imports.started', { count: chosen.length }))
        setPicked(null)
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

  if (!configured || editing) return <GoogleSetup onDone={() => setEditing(false)} />

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-4">
        <div className="min-w-0 flex-1 text-sm">
          {token ? (
            <span className="flex items-center gap-1.5 font-medium">
              <CircleCheck className="size-4 text-success" />
              {t('imports.gd.connected')}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('imports.gd.notConnected')}</span>
          )}
          <span className="block text-xs text-muted-foreground">{t('imports.gd.bandwidthHint')}</span>
        </div>
        <Button onClick={() => void pickFiles()} disabled={listing !== null}>
          <HardDriveDownload />
          {t('imports.gd.pickFiles')}
        </Button>
        <Button variant="outline" onClick={() => void pickFolder()} disabled={listing !== null}>
          <FolderOpen />
          {t('imports.gd.pickFolder')}
        </Button>
        {token && (
          <Button variant="ghost" size="icon" onClick={disconnectGoogle} aria-label={t('imports.gd.disconnect')} title={t('imports.gd.disconnect')}>
            <LogOut />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label={t('imports.gd.config')} title={t('imports.gd.config')}>
          <Settings2 />
        </Button>
      </div>

      {listing !== null && (
        <div className="grid gap-1.5">
          <Progress value={0} indeterminate />
          <span className="text-xs text-muted-foreground">{t('imports.gd.listing', { count: listing })}</span>
        </div>
      )}

      {picked && listing === null && (
        <>
          {picked.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('imports.gd.emptyFolder')}</p>
          ) : (
            <div className="grid gap-2">
              <SelectionBar
                total={picked.entries.length}
                selected={chosen.length}
                size={chosenSize}
                onAll={() => setSelected(new Set(picked.entries.filter((e) => !e.skip && !sources.has(`gd:${e.fileId}`)).map((e) => e.fileId)))}
                onNone={() => setSelected(new Set())}
              />
              <PickList
                rows={rows}
                selected={selected}
                onToggle={(key) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
              />
            </div>
          )}
          <FolderTarget value={target} onChange={setTarget} />
          {picked.mode === 'folder' && (
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="flex gap-2">
                <FolderSync className="mt-0.5 size-4 text-muted-foreground" />
                <span>
                  {t('imports.gd.remember')}
                  <span className="block text-xs text-muted-foreground">{t('imports.gd.rememberHint')}</span>
                </span>
              </span>
              <Switch checked={remember} onCheckedChange={setRemember} />
            </label>
          )}
          <div className="flex justify-end">
            <Button size="lg" onClick={start} disabled={busy || !chosen.length}>
              {busy && <Spinner />}
              {t('imports.importCount', { count: chosen.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
