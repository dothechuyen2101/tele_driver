import { useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { CloudUpload, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMatch } from 'react-router'
import { moveTo, startUpload, trashWithUndo } from '@/app/actions'
import { db } from '@/db/db'
import { buildIndex, type DriveItem } from '@/drive/model'
import { canMoveInto } from '@/drive/ops'
import { hasActiveUploads } from '@/drive/uploads'
import { decryptPendingNames } from '@/drive/vault'
import { useCurrentFolderId } from '@/hooks/useView'
import { collectDropped, hasFiles } from '@/lib/dropFiles'
import { reportError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useApp, useDrive } from '@/stores/app'
import { useTransfers } from '@/stores/transfers'
import { useUi } from '@/stores/ui'
import { chatKeyOf } from '@/telegram/peers'
import { Dialogs } from '../dialogs/Dialogs'
import { ImportPage } from '../import/ImportPage'
import { Button } from '../ui/button'
import { Browser } from './Browser'
import { FileIcon } from './FileIcon'
import { NewMenu } from './NewMenu'
import { PreviewModal } from './PreviewModal'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TransferPanel } from './TransferPanel'

/** Rebuilds the drive index whenever the stored entries or decrypted names change. */
function useIndexSync() {
  const storage = useApp((s) => s.storage)
  const chatKey = storage ? chatKeyOf(storage) : null
  const entries = useLiveQuery(() => (chatKey ? db.entries.where('chatKey').equals(chatKey).toArray() : []), [chatKey])
  const decrypted = useDrive((s) => s.decrypted)
  const vaultKey = useDrive((s) => s.vaultKey)
  useEffect(() => {
    if (entries) useDrive.setState({ index: buildIndex(entries, decrypted) })
  }, [entries, decrypted])
  useEffect(() => {
    if (vaultKey && entries) void decryptPendingNames(useDrive.getState().index, vaultKey)
  }, [vaultKey, entries])
}

/** Files shared to the installed PWA arrive through the service worker's Cache Storage. */
function useShareTarget() {
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (!params.has('share')) return
    history.replaceState(null, '', location.pathname)
    void (async () => {
      const cache = await caches.open('td-share')
      const files: File[] = []
      for (const req of await cache.keys()) {
        const res = await cache.match(req)
        if (res) {
          const blob = await res.blob()
          files.push(new File([blob], decodeURIComponent(res.headers.get('X-Name') ?? 'file'), { type: blob.type }))
        }
        await cache.delete(req)
      }
      if (files.length) startUpload(files.map((file) => ({ file, folderId: 0 })))
    })().catch((err) => reportError(err))
  }, [])
}

function usePasteUpload(folderId: number) {
  const ref = useRef(folderId)
  useEffect(() => {
    ref.current = folderId
  }, [folderId])
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(target.tagName) || target.isContentEditable || useUi.getState().dialog) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      startUpload(files.map((file) => ({ file, folderId: ref.current })))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

function useLeaveGuard() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const busy = hasActiveUploads() || useTransfers.getState().items.some((t) => t.kind === 'download' && t.status === 'running')
      if (busy) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}

function itemsFromKeys(keys: Iterable<string>): DriveItem[] {
  const { index } = useDrive.getState()
  const out: DriveItem[] = []
  for (const key of keys) {
    const item = key.startsWith('d:') ? index.folders.get(Number(key.slice(2))) : index.files.get(key)
    if (item) out.push(item)
  }
  return out
}

function DragChip({ items }: { items: DriveItem[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex w-max max-w-64 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xl">
      <FileIcon item={items[0]} className="size-4 text-primary-foreground!" />
      <span className="truncate">{items.length === 1 ? items[0].name : t('browser.dragCount', { count: items.length })}</span>
    </div>
  )
}

export function DriveApp() {
  const { t } = useTranslation()
  const folderId = useCurrentFolderId()
  const onImportPage = !!useMatch('/import')
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const [dragging, setDragging] = useState<DriveItem[] | null>(null)
  const [osDrag, setOsDrag] = useState(false)
  const depth = useRef(0)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }))

  useIndexSync()
  useShareTarget()
  usePasteUpload(folderId)
  useLeaveGuard()

  const onDragStart = (e: DragStartEvent) => {
    const item = e.active.data.current?.item as DriveItem | undefined
    if (!item) return
    const ui = useUi.getState()
    if (!ui.selected.has(item.key)) ui.select([item.key])
    setDragging(itemsFromKeys(useUi.getState().selected))
  }

  const onDragEnd = (e: DragEndEvent) => {
    const items = dragging
    setDragging(null)
    const data = e.over?.data.current as { folderId?: number; trash?: boolean } | undefined
    if (!items?.length || !data) return
    if (data.trash) void trashWithUndo(items)
    else if (typeof data.folderId === 'number' && canMoveInto(items, data.folderId)) void moveTo(items, data.folderId)
  }

  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOsDrag(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOsDrag(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOsDrag(false)
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-folder-id]')
      const destination = target ? Number(target.dataset.folderId) : folderId
      collectDropped(e.dataTransfer)
        .then((list) => startUpload(list.map((d) => ({ ...d, folderId: destination }))))
        .catch((err) => reportError(err))
    },
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="flex h-full flex-col bg-sidebar">
          <Topbar />
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-64 shrink-0 md:block">
              <Sidebar />
            </aside>
            {sidebarOpen && (
              <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)}>
                <aside className="h-full w-72 max-w-[85vw] bg-sidebar shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <Sidebar />
                </aside>
              </div>
            )}
            <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:mr-3 md:mb-3 md:rounded-2xl md:border" {...dropHandlers}>
              {onImportPage ? <ImportPage /> : <Browser />}
              <div
                className={cn(
                  'pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-primary backdrop-blur-[1px] transition-opacity',
                  osDrag ? 'opacity-100' : 'opacity-0',
                )}
              >
                <CloudUpload className="size-12" />
                <p className="text-lg font-semibold">{t('browser.dropHere')}</p>
              </div>
            </main>
          </div>
          <div className="fixed right-5 bottom-5 z-30 md:hidden">
            <NewMenu align="end">
              <Button size="icon" className="size-14 rounded-2xl shadow-lg" aria-label={t('new.button')}>
                <Plus className="size-6!" />
              </Button>
            </NewMenu>
          </div>
          <TransferPanel />
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <DragChip items={dragging} />}</DragOverlay>
      </DndContext>
      <PreviewModal />
      <Dialogs />
    </>
  )
}
