import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderLock, FolderPlus, HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { moveTo } from '@/app/actions'
import { canMoveInto, createFolder } from '@/drive/ops'
import { folderPath, type DriveItem } from '@/drive/model'
import { reportError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../ui/dialog'
import { Input } from '../ui/input'
import { Spinner } from '../ui/misc'

export function MoveDialog({ items, onClose }: { items: DriveItem[]; onClose: () => void }) {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const start = items[0]?.type === 'folder' ? items[0].parentId : (items[0]?.folderId ?? 0)
  const [cwd, setCwd] = useState(start)
  const [creating, setCreating] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const moving = useMemo(() => new Set(items.filter((i) => i.type === 'folder').map((i) => i.id)), [items])
  const children = useMemo(
    () => (index.childFolders.get(cwd) ?? []).filter((f) => !f.trashedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [index, cwd],
  )
  const path = folderPath(index, cwd)
  const allowed = canMoveInto(items, cwd)

  const submit = async () => {
    setBusy(true)
    onClose()
    await moveTo(items, cwd)
  }

  const makeFolder = async () => {
    if (!creating?.trim()) return setCreating(null)
    try {
      const id = await createFolder(cwd, creating)
      setCreating(null)
      setCwd(id)
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader title={t('move.title', { count: items.length })} />
        <div className="flex items-center gap-1 text-sm">
          {cwd !== 0 && (
            <Button variant="ghost" size="icon-sm" onClick={() => setCwd(path.at(-2)?.id ?? 0)} aria-label={t('common.back')}>
              <ChevronLeft />
            </Button>
          )}
          <span className="truncate font-medium">{cwd === 0 ? t('nav.myDrive') : path.at(-1)?.name}</span>
        </div>
        <div className="h-72 overflow-y-auto rounded-lg border scrollbar-thin">
          {cwd === 0 && children.length === 0 && !creating && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <HardDrive className="size-8" />
              {t('move.rootOnly')}
            </div>
          )}
          {children.map((f) => {
            const disabled = moving.has(f.id)
            return (
              <button
                key={f.id}
                type="button"
                disabled={disabled}
                onClick={() => setCwd(f.id)}
                className={cn('flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent disabled:opacity-40')}
              >
                {f.encrypted ? <FolderLock className="size-4 text-amber-500" /> : <Folder className="size-4 text-amber-500" />}
                <span className="flex-1 truncate">{f.name}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            )
          })}
          {creating !== null && (
            <form
              className="flex items-center gap-2 p-2"
              onSubmit={(e) => {
                e.preventDefault()
                void makeFolder()
              }}
            >
              <Input autoFocus value={creating} onChange={(e) => setCreating(e.target.value)} onBlur={() => void makeFolder()} />
            </form>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => setCreating(t('newFolder.default'))}>
            <FolderPlus />
            {t('new.folder')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={!allowed || busy}>
              {busy && <Spinner />}
              {t('move.here')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
