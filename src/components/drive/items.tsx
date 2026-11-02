import { useState, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Check, EllipsisVertical, Lock, Play, Split, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { buildItemActions, openItem } from '@/app/actions'
import { formatBytes, formatDate, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import type { DriveFile, DriveFolder, DriveItem } from '@/drive/model'
import { ActionContextMenu, ActionDropdown, type MenuAction } from '../ui/menu'
import { FileIcon } from './FileIcon'
import { ThumbImage } from './Thumb'

const coarsePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function selectedItems(ordered: DriveItem[]) {
  const sel = useUi.getState().selected
  return ordered.filter((i) => sel.has(i.key))
}

/** Selection, opening and menu behaviour of one item (drag & drop is wired in `Shell`). */
function useItemBehaviour(item: DriveItem, ordered: DriveItem[], inTrash: boolean) {
  const navigate = useNavigate()
  const selected = useUi((s) => s.selected.has(item.key))
  const selecting = useUi((s) => s.selected.size > 0)
  const [actions, setActions] = useState<MenuAction[]>([])

  const ensureSelected = () => {
    const ui = useUi.getState()
    if (!ui.selected.has(item.key)) ui.select([item.key])
  }

  const refreshActions = () => {
    ensureSelected()
    setActions(buildItemActions(selectedItems(ordered), { inTrash, siblings: ordered, navigate }))
  }

  const onClick = (e: React.MouseEvent) => {
    // Clicks inside portaled menus bubble through the React tree; ignore them.
    if (!e.currentTarget.contains(e.target as Node)) return
    e.stopPropagation()
    const ui = useUi.getState()
    if (e.shiftKey && ui.anchor) {
      const a = ordered.findIndex((i) => i.key === ui.anchor)
      const b = ordered.findIndex((i) => i.key === item.key)
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a]
        ui.select(
          ordered.slice(from, to + 1).map((i) => i.key),
          ui.anchor,
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) return ui.toggle(item.key)
    if (coarsePointer()) {
      if (ui.selected.size > 0) return ui.toggle(item.key)
      if (!inTrash) return openItem(item, ordered, navigate)
    }
    ui.select([item.key])
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!e.currentTarget.contains(e.target as Node)) return
    if (!inTrash) openItem(item, ordered, navigate)
  }

  const toggleCheck = (e: React.MouseEvent) => {
    e.stopPropagation()
    useUi.getState().toggle(item.key)
  }

  return { selected, selecting, actions, refreshActions, onClick, onDoubleClick, toggleCheck }
}

type Behaviour = ReturnType<typeof useItemBehaviour>
type ShellState = { selected: boolean; dropOver: boolean; dragging: boolean }

function SelectCheck({ selected, visible, onClick }: { selected: boolean; visible: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="select"
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border-2 transition',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background/80',
        visible || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}
    >
      {selected && <Check className="size-3" strokeWidth={3} />}
    </button>
  )
}

function MoreButton({ actions, onOpen }: { actions: MenuAction[]; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <ActionDropdown actions={actions} onOpenChange={(open) => open && onOpen()}>
      <button
        type="button"
        aria-label={t('common.more')}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground opacity-70 transition hover:bg-accent hover:opacity-100"
      >
        <EllipsisVertical className="size-4" />
      </button>
    </ActionDropdown>
  )
}

function Shell({
  item,
  ordered,
  inTrash,
  className,
  children,
}: {
  item: DriveItem
  ordered: DriveItem[]
  inTrash: boolean
  className: (s: ShellState) => string
  children: (b: Behaviour) => ReactNode
}) {
  const b = useItemBehaviour(item, ordered, inTrash)
  const isFolder = item.type === 'folder'
  const { setNodeRef: setDragNode, listeners, attributes, isDragging } = useDraggable({ id: item.key, data: { item }, disabled: inTrash })
  const { setNodeRef: setDropNode, isOver } = useDroppable({
    id: `drop:${item.key}`,
    data: { folderId: isFolder ? item.id : undefined },
    disabled: !isFolder || inTrash,
  })
  const attachNode = (el: HTMLElement | null) => {
    setDragNode(el)
    if (isFolder) setDropNode(el)
  }
  return (
    <ActionContextMenu actions={b.actions} onOpenChange={(open) => open && b.refreshActions()}>
      <div
        ref={attachNode}
        {...listeners}
        {...attributes}
        role="option"
        aria-selected={b.selected}
        tabIndex={-1}
        data-item-key={item.key}
        data-folder-id={isFolder ? item.id : undefined}
        onClick={b.onClick}
        onDoubleClick={b.onDoubleClick}
        className={cn('group relative outline-none select-none', className({ selected: b.selected, dropOver: isOver, dragging: isDragging }))}
      >
        {children(b)}
      </div>
    </ActionContextMenu>
  )
}

function FileBadges({ file }: { file: DriveFile }) {
  const { t } = useTranslation()
  return (
    <>
      {file.enc && (
        <span title={t('item.encrypted')} className="text-emerald-600 dark:text-emerald-400">
          <Lock className="size-3.5" />
        </span>
      )}
      {file.partCount > 1 && (
        <span title={t('item.split', { count: file.partCount })} className="text-muted-foreground">
          <Split className="size-3.5" />
        </span>
      )}
      {!file.complete && (
        <span title={t('item.incomplete')} className="text-warning">
          <TriangleAlert className="size-3.5" />
        </span>
      )}
    </>
  )
}

function displayName(item: DriveItem, t: (k: string) => string) {
  return item.type === 'file' && item.locked ? t('item.lockedName') : item.name
}

export function FolderTile({ folder, ordered, inTrash }: { folder: DriveFolder; ordered: DriveItem[]; inTrash: boolean }) {
  const { t } = useTranslation()
  return (
    <Shell
      item={folder}
      ordered={ordered}
      inTrash={inTrash}
      className={({ selected, dropOver, dragging }) =>
        cn(
          'flex h-14 items-center gap-3 rounded-xl border bg-card px-3 transition-colors',
          selected ? 'border-primary/50 bg-selection' : 'hover:bg-accent/60',
          dropOver && 'border-primary ring-2 ring-primary/40',
          dragging && 'opacity-40',
        )
      }
    >
      {(b) => (
        <>
          <div className="relative">
            <FileIcon item={folder} className={cn('size-6 transition-opacity', (b.selecting || b.selected) && 'opacity-0 group-hover:opacity-0')} />
            <div className="absolute inset-0 grid place-items-center">
              <SelectCheck selected={b.selected} visible={b.selecting} onClick={b.toggleCheck} />
            </div>
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={folder.name}>
            {folder.name}
          </span>
          <MoreButton actions={b.actions} onOpen={b.refreshActions} />
          {inTrash && folder.trashedAt && <span className="sr-only">{t('trash.trashedOn', { date: formatDate(folder.trashedAt) })}</span>}
        </>
      )}
    </Shell>
  )
}

export function FileCard({ file, ordered, inTrash }: { file: DriveFile; ordered: DriveItem[]; inTrash: boolean }) {
  const { t } = useTranslation()
  return (
    <Shell
      item={file}
      ordered={ordered}
      inTrash={inTrash}
      className={({ selected, dragging }) =>
        cn(
          'flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors',
          selected ? 'border-primary/50 bg-selection' : 'hover:bg-accent/40',
          dragging && 'opacity-40',
        )
      }
    >
      {(b) => (
        <>
          <div className="relative min-h-0 flex-1 bg-muted/50">
            <ThumbImage file={file} fallback={<div className="grid size-full place-items-center"><FileIcon item={file} className="size-12 opacity-90" /></div>} />
            {file.category === 'video' && file.media.duration ? (
              <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
                <Play className="size-2.5 fill-current" />
                {formatDuration(file.media.duration)}
              </span>
            ) : null}
            <div className="absolute top-2 left-2">
              <SelectCheck selected={b.selected} visible={b.selecting} onClick={b.toggleCheck} />
            </div>
          </div>
          <div className="flex h-12 shrink-0 items-center gap-2 px-2.5">
            <FileIcon item={file} className="size-4" />
            <div className="min-w-0 flex-1">
              <div className={cn('truncate text-sm font-medium', file.locked && 'italic text-muted-foreground')} title={file.name}>
                {displayName(file, t)}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{formatBytes(file.size)}</span>
                <FileBadges file={file} />
              </div>
            </div>
            <MoreButton actions={b.actions} onOpen={b.refreshActions} />
          </div>
        </>
      )}
    </Shell>
  )
}

export function ListRow({ item, ordered, inTrash }: { item: DriveItem; ordered: DriveItem[]; inTrash: boolean }) {
  const { t } = useTranslation()
  const date = inTrash ? (item.trashedAt ?? item.date) : item.date
  return (
    <Shell
      item={item}
      ordered={ordered}
      inTrash={inTrash}
      className={({ selected, dropOver, dragging }) =>
        cn(
          'flex h-12 items-center gap-3 border-b px-3 text-sm transition-colors sm:px-4',
          selected ? 'bg-selection' : 'hover:bg-accent/50',
          dropOver && 'bg-primary/10 ring-2 ring-primary/40 ring-inset',
          dragging && 'opacity-40',
        )
      }
    >
      {(b) => (
        <>
          <SelectCheck selected={b.selected} visible={b.selecting} onClick={b.toggleCheck} />
          <div className="size-8 shrink-0 overflow-hidden rounded-md">
            {item.type === 'file' && (item.category === 'image' || item.category === 'video') ? (
              <ThumbImage file={item} fallback={<div className="grid size-full place-items-center"><FileIcon item={item} className="size-5" /></div>} />
            ) : (
              <div className="grid size-full place-items-center">
                <FileIcon item={item} className="size-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn('flex items-center gap-1.5 truncate font-medium', item.type === 'file' && item.locked && 'italic text-muted-foreground')}>
              <span className="truncate" title={item.name}>
                {displayName(item, t)}
              </span>
              {item.type === 'file' && <FileBadges file={item} />}
            </div>
            <div className="truncate text-xs text-muted-foreground md:hidden">
              {formatDate(date)}
              {item.type === 'file' ? ` · ${formatBytes(item.size)}` : ''}
            </div>
          </div>
          <div className="hidden w-36 shrink-0 text-muted-foreground md:block">{formatDate(date)}</div>
          <div className="hidden w-24 shrink-0 text-right text-muted-foreground md:block">{item.type === 'file' ? formatBytes(item.size) : '—'}</div>
          <MoreButton actions={b.actions} onOpen={b.refreshActions} />
        </>
      )}
    </Shell>
  )
}
