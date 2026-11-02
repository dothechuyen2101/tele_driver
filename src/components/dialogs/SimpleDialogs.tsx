import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createFolder, renameItem } from '@/drive/ops'
import { folderPath, isFolderEncrypted, type DriveItem } from '@/drive/model'
import { formatBytes, formatDate } from '@/lib/format'
import { describeError, reportError } from '@/lib/uiErrors'
import { useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../ui/dialog'
import { Input } from '../ui/input'
import { Spinner, Switch } from '../ui/misc'

export function NewFolderDialog({ parentId, onClose }: { parentId: number; onClose: () => void }) {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const inheritsEncryption = isFolderEncrypted(index, parentId)
  const [name, setName] = useState(t('newFolder.default'))
  const [encrypted, setEncrypted] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await createFolder(parentId, name, encrypted && !inheritsEncryption)
      onClose()
      if (encrypted && !index.vault) useUi.getState().openDialog({ kind: 'vault', mode: 'create' })
    } catch (err) {
      reportError(err)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader title={t('newFolder.title')} />
        <form onSubmit={submit} className="grid gap-4">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} maxLength={200} />
          {inheritsEncryption ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5 text-emerald-500" />
              {t('newFolder.inherits')}
            </p>
          ) : (
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Switch checked={encrypted} onCheckedChange={setEncrypted} />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t('newFolder.encrypted')}</span>
                <span className="text-xs text-muted-foreground">{t('newFolder.encryptedHint')}</span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Spinner />}
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RenameDialog({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === item.name) return onClose()
    setBusy(true)
    try {
      await renameItem(item, name)
      onClose()
    } catch (err) {
      reportError(err)
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader title={t('rename.title')} />
        <form onSubmit={submit} className="grid gap-4">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={250}
            onFocus={(e) => {
              const dot = item.type === 'file' ? e.target.value.lastIndexOf('.') : -1
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
            }}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Spinner />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({
  title,
  message,
  danger,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  danger?: boolean
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title={title} description={message} />
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={() => void run()} disabled={busy}>
            {busy && <Spinner />}
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DetailsDialog({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const parentId = item.type === 'folder' ? item.parentId : item.folderId
  const location = [t('nav.myDrive'), ...folderPath(index, parentId).map((f) => f.name)].join(' / ')
  const rows: [string, string][] = [
    [t('details.type'), item.type === 'folder' ? t('details.folder') : item.mime],
    [t('details.location'), location],
    [t('details.created'), formatDate(item.date, true)],
  ]
  if (item.type === 'file') {
    rows.splice(1, 0, [t('details.size'), `${formatBytes(item.size)} (${item.size.toLocaleString()} B)`])
    rows.push([t('details.encryption'), item.enc ? t('details.e2e') : t('details.none')])
    if (item.partCount > 1) rows.push([t('details.parts'), `${item.parts.length}/${item.partCount}`])
    rows.push([t('details.messages'), item.parts.map((p) => `#${p.msgId}`).join(', ')])
    if (item.userText) rows.push([t('details.caption'), item.userText])
  } else {
    rows.push([t('details.messages'), `#${item.id}`])
    if (isFolderEncrypted(index, item.id)) rows.push([t('details.encryption'), t('details.e2eFolder')])
  }
  if (item.trashedAt) rows.push([t('trash.trashedAt'), formatDate(item.trashedAt, true)])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={item.name || t('item.lockedName')} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

