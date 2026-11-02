/** User-facing actions shared by menus, toolbars, keyboard shortcuts and drag & drop. */
import { toast } from 'sonner'
import {
  Download,
  Eye,
  FolderInput,
  FolderOpen,
  Info,
  PencilLine,
  RotateCcw,
  Send,
  Trash,
  CircleX,
} from 'lucide-react'
import i18n from '@/i18n'
import type { MenuAction } from '@/components/ui/menu'
import { downloadAsZip, downloadFile } from '@/drive/downloads'
import type { DriveFile, DriveFolder, DriveItem } from '@/drive/model'
import { emptyTrash, moveItems, purgeItems, restoreItems, trashItems } from '@/drive/ops'
import { enqueueUploads, needsEncryption, type UploadRequest } from '@/drive/uploads'
import { reportError } from '@/lib/uiErrors'
import { useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts)

/** Runs `fn` once the end-to-end vault is unlocked, asking for the password if needed. */
export function withVault(fn: () => void | Promise<void>) {
  const { vaultKey, index } = useDrive.getState()
  if (vaultKey) {
    void fn()
    return
  }
  useUi.getState().openDialog({ kind: 'vault', mode: index.vault ? 'unlock' : 'create', then: () => void fn() })
}

const needsVault = (items: DriveItem[]) => items.some((i) => i.type === 'file' && !!i.enc)

export function openItem(item: DriveItem, siblings: DriveItem[], navigate: (to: string) => void) {
  if (item.type === 'folder') {
    useUi.getState().clearSelection()
    navigate(`/folder/${item.id}`)
    return
  }
  const keys = siblings.filter((i) => i.type === 'file').map((i) => i.key)
  const open = () => useUi.getState().openPreview(item.key, keys)
  if (item.enc) withVault(open)
  else open()
}

export function downloadItems(items: DriveItem[]) {
  const run = async () => {
    try {
      if (items.length === 1 && items[0].type === 'file') {
        await downloadFile(items[0])
        return
      }
      const name =
        items.length === 1 ? `${items[0].name}.zip` : `TeleDriver-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`
      toast.info(t('actions.zipStarted'))
      await downloadAsZip(items, name)
    } catch (err) {
      reportError(err, t('actions.downloadFailed'))
    }
  }
  if (needsVault(items) || items.some((i) => i.type === 'folder' && hasEncryptedInside(i))) withVault(run)
  else void run()
}

function hasEncryptedInside(folder: DriveFolder) {
  const { index } = useDrive.getState()
  const stack = [folder.id]
  while (stack.length) {
    const id = stack.pop()!
    if ((index.childFiles.get(id) ?? []).some((f) => !!f.enc)) return true
    for (const sub of index.childFolders.get(id) ?? []) stack.push(sub.id)
  }
  return false
}

export async function trashWithUndo(items: DriveItem[]) {
  if (!items.length) return
  try {
    await trashItems(items)
    useUi.getState().clearSelection()
    toast.success(t('actions.trashed', { count: items.length }), {
      action: { label: t('common.undo'), onClick: () => void restoreItems(items).catch((e) => reportError(e)) },
    })
  } catch (err) {
    reportError(err, t('actions.trashFailed'))
  }
}

export async function restore(items: DriveItem[]) {
  try {
    await restoreItems(items)
    useUi.getState().clearSelection()
    toast.success(t('actions.restored', { count: items.length }))
  } catch (err) {
    reportError(err)
  }
}

export function confirmDeleteForever(items: DriveItem[]) {
  useUi.getState().openDialog({
    kind: 'confirm',
    title: t('actions.deleteForeverTitle', { count: items.length }),
    message: t('actions.deleteForeverMessage'),
    danger: true,
    confirmLabel: t('actions.deleteForever'),
    onConfirm: async () => {
      await purgeItems(items)
      useUi.getState().clearSelection()
      toast.success(t('actions.deleted', { count: items.length }))
    },
  })
}

export function confirmEmptyTrash() {
  useUi.getState().openDialog({
    kind: 'confirm',
    title: t('trash.emptyTitle'),
    message: t('trash.emptyMessage'),
    danger: true,
    confirmLabel: t('trash.empty'),
    onConfirm: async () => {
      await emptyTrash()
      toast.success(t('trash.emptied'))
    },
  })
}

export async function moveTo(items: DriveItem[], folderId: number) {
  if (!items.length) return
  const id = toast.loading(t('actions.moving', { count: items.length }))
  try {
    await moveItems(items, folderId)
    useUi.getState().clearSelection()
    toast.success(t('actions.moved', { count: items.length }), { id })
  } catch (err) {
    toast.dismiss(id)
    reportError(err, t('actions.moveFailed'))
  }
}

export function startUpload(requests: UploadRequest[]) {
  if (!requests.length) return
  const run = () =>
    enqueueUploads(requests)
      .then(() => useUi.getState().setTransfersOpen(true))
      .catch((err) => reportError(err, t('actions.uploadFailed')))
  if (requests.some((r) => needsEncryption(r.folderId))) withVault(run)
  else void run()
}

/** Menu entries for a selection in a given view. */
export function buildItemActions(items: DriveItem[], ctx: { inTrash: boolean; siblings: DriveItem[]; navigate: (to: string) => void }): MenuAction[] {
  const ui = useUi.getState()
  if (!items.length) return []
  const single = items.length === 1 ? items[0] : undefined
  const files = items.filter((i): i is DriveFile => i.type === 'file')
  if (ctx.inTrash) {
    return [
      { key: 'restore', label: t('actions.restore'), icon: <RotateCcw />, onSelect: () => void restore(items) },
      { key: 'delete', label: t('actions.deleteForever'), icon: <CircleX />, danger: true, onSelect: () => confirmDeleteForever(items) },
    ]
  }
  const actions: MenuAction[] = []
  if (single) {
    actions.push({
      key: 'open',
      label: single.type === 'folder' ? t('actions.open') : t('actions.preview'),
      icon: single.type === 'folder' ? <FolderOpen /> : <Eye />,
      shortcut: '↵',
      onSelect: () => openItem(single, ctx.siblings, ctx.navigate),
    })
  }
  actions.push({
    key: 'download',
    label: single?.type === 'file' ? t('actions.download') : t('actions.downloadZip'),
    icon: <Download />,
    disabled: single?.type === 'file' && !single.complete,
    onSelect: () => downloadItems(items),
  })
  if (single) {
    actions.push({
      key: 'rename',
      label: t('actions.rename'),
      icon: <PencilLine />,
      shortcut: 'F2',
      separatorBefore: true,
      onSelect: () => (single.type === 'file' && single.enc ? withVault(() => ui.openDialog({ kind: 'rename', item: single })) : ui.openDialog({ kind: 'rename', item: single })),
    })
  }
  actions.push({ key: 'move', label: t('actions.move'), icon: <FolderInput />, separatorBefore: !single, onSelect: () => ui.openDialog({ kind: 'move', items }) })
  if (files.length === items.length) {
    actions.push({ key: 'forward', label: t('actions.forward'), icon: <Send />, onSelect: () => ui.openDialog({ kind: 'forward', files }) })
  }
  if (single) actions.push({ key: 'details', label: t('actions.details'), icon: <Info />, onSelect: () => ui.openDialog({ kind: 'details', item: single }) })
  actions.push({
    key: 'trash',
    label: t('actions.trash'),
    icon: <Trash />,
    shortcut: 'Del',
    danger: true,
    separatorBefore: true,
    onSelect: () => void trashWithUndo(items),
  })
  return actions
}
