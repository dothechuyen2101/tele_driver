import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDroppable } from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  EllipsisVertical,
  FolderInput,
  FolderSearch,
  Inbox,
  LayoutGrid,
  List,
  RotateCcw,
  Send,
  Trash,
  CircleX,
  X,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  buildItemActions,
  confirmDeleteForever,
  confirmEmptyTrash,
  downloadItems,
  restore,
  trashWithUndo,
} from '@/app/actions'
import { useCurrentView, useViewItems, type ViewKind } from '@/hooks/useView'
import { CATEGORIES } from '@/lib/mime'
import { cn } from '@/lib/utils'
import { useApp, useDrive } from '@/stores/app'
import { useUi, type DateFilter, type SizeFilter, type SortKey } from '@/stores/ui'
import { folderPath, type DriveFile, type DriveFolder, type DriveItem } from '@/drive/model'
import { Button } from '../ui/button'
import { ActionDropdown } from '../ui/menu'
import { Progress, Tip } from '../ui/misc'
import { FileCard, FolderTile, ListRow } from './items'

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return width
}

function Crumb({ id, name, last }: { id: number; name: string; last: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: `drop:crumb:${id}`, data: { folderId: id } })
  return (
    <Link
      ref={setNodeRef}
      to={id ? `/folder/${id}` : '/'}
      className={cn(
        'truncate rounded-md px-2 py-1 transition-colors hover:bg-accent',
        last ? 'font-semibold text-foreground' : 'text-muted-foreground',
        isOver && 'bg-primary/15 ring-2 ring-primary/40',
      )}
    >
      {name}
    </Link>
  )
}

function Header({ view }: { view: ViewKind }) {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const search = useUi((s) => s.search)
  if (search.trim()) {
    return <h1 className="truncate px-2 text-lg font-semibold">{t('browser.searchResults', { query: search.trim() })}</h1>
  }
  if (view.kind === 'folder') {
    const path = folderPath(index, view.id)
    return (
      <nav className="flex min-w-0 items-center text-lg" aria-label="breadcrumb">
        <Crumb id={0} name={t('nav.myDrive')} last={path.length === 0} />
        {path.map((f, i) => (
          <span key={f.id} className="flex min-w-0 items-center">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            <Crumb id={f.id} name={f.name} last={i === path.length - 1} />
          </span>
        ))}
      </nav>
    )
  }
  const title = view.kind === 'trash' ? t('nav.trash') : view.kind === 'recent' ? t('nav.recent') : t(`category.${view.category}`)
  return <h1 className="truncate px-2 text-lg font-semibold">{title}</h1>
}

function SelectionBar({ items, view }: { items: DriveItem[]; view: ViewKind }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const selectedKeys = useUi((s) => s.selected)
  const clear = useUi((s) => s.clearSelection)
  const openDialog = useUi((s) => s.openDialog)
  const selected = useMemo(() => items.filter((i) => selectedKeys.has(i.key)), [items, selectedKeys])
  const inTrash = view.kind === 'trash'
  const allFiles = selected.every((i) => i.type === 'file')
  const icon = (label: string, Icon: typeof X, onClick: () => void, disabled = false) => (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label}>
        <Icon />
      </Button>
    </Tip>
  )
  return (
    <div className="flex h-11 items-center gap-1 rounded-full bg-secondary px-2">
      {icon(t('common.clearSelection'), X, clear)}
      <span className="mr-2 text-sm font-medium whitespace-nowrap">{t('browser.selected', { count: selected.length })}</span>
      {inTrash ? (
        <>
          {icon(t('actions.restore'), RotateCcw, () => void restore(selected))}
          {icon(t('actions.deleteForever'), CircleX, () => confirmDeleteForever(selected))}
        </>
      ) : (
        <>
          {icon(t('actions.download'), Download, () => downloadItems(selected))}
          {icon(t('actions.move'), FolderInput, () => openDialog({ kind: 'move', items: selected }))}
          {allFiles && icon(t('actions.forward'), Send, () => openDialog({ kind: 'forward', files: selected as DriveFile[] }))}
          {icon(t('actions.trash'), Trash, () => void trashWithUndo(selected))}
          <ActionDropdown actions={buildItemActions(selected, { inTrash, siblings: items, navigate })}>
            <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
              <EllipsisVertical />
            </Button>
          </ActionDropdown>
        </>
      )}
    </div>
  )
}

function FilterChips({ view }: { view: ViewKind }) {
  const { t } = useTranslation()
  const filters = useUi((s) => s.filters)
  const setFilters = useUi((s) => s.setFilters)
  const reset = useUi((s) => s.resetFilters)
  const active = filters.type !== 'any' || filters.size !== 'any' || filters.date !== 'any'
  const chip = (label: string, on: boolean, actions: { key: string; label: string; onSelect: () => void }[]) => (
    <ActionDropdown actions={actions} align="start">
      <button
        type="button"
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg border px-3 text-sm transition-colors',
          on ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent',
        )}
      >
        {label}
      </button>
    </ActionDropdown>
  )
  const types = view.kind === 'smart' ? [] : (['any', 'folder', ...CATEGORIES] as const)
  const sizes: SizeFilter[] = ['any', 'lt1m', '1m-100m', '100m-1g', 'gt1g']
  const dates: DateFilter[] = ['any', 'today', '7d', '30d', 'year']
  return (
    <div className="flex flex-wrap items-center gap-2">
      {types.length > 0 &&
        chip(
          filters.type === 'any' ? t('filters.type') : filters.type === 'folder' ? t('filters.folders') : t(`category.${filters.type}`),
          filters.type !== 'any',
          types.map((ty) => ({
            key: ty,
            label: ty === 'any' ? t('filters.anyType') : ty === 'folder' ? t('filters.folders') : t(`category.${ty}`),
            onSelect: () => setFilters({ type: ty }),
          })),
        )}
      {chip(
        filters.size === 'any' ? t('filters.size') : t(`filters.sizes.${filters.size}`),
        filters.size !== 'any',
        sizes.map((s) => ({ key: s, label: t(`filters.sizes.${s}`), onSelect: () => setFilters({ size: s }) })),
      )}
      {chip(
        filters.date === 'any' ? t('filters.modified') : t(`filters.dates.${filters.date}`),
        filters.date !== 'any',
        dates.map((d) => ({ key: d, label: t(`filters.dates.${d}`), onSelect: () => setFilters({ date: d }) })),
      )}
      {active && (
        <Button variant="ghost" size="sm" onClick={reset}>
          <X />
          {t('filters.clear')}
        </Button>
      )}
    </div>
  )
}

function SortMenu() {
  const { t } = useTranslation()
  const sortKey = useUi((s) => s.sortKey)
  const sortDir = useUi((s) => s.sortDir)
  const setSort = useUi((s) => s.setSort)
  const keys: SortKey[] = ['name', 'date', 'size', 'type']
  const Arrow = sortDir === 'asc' ? ArrowUp : ArrowDown
  return (
    <ActionDropdown actions={keys.map((k) => ({ key: k, label: `${t(`sort.${k}`)}${k === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`, onSelect: () => setSort(k) }))}>
      <Button variant="ghost" size="sm">
        <Arrow />
        {t(`sort.${sortKey}`)}
      </Button>
    </ActionDropdown>
  )
}

type Row = { type: 'header'; label: string } | { type: 'folders'; items: DriveFolder[] } | { type: 'files'; items: DriveFile[] }

const GAP = 12

function GridView({ items, inTrash, scrollRef }: { items: DriveItem[]; inTrash: boolean; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const width = useWidth(scrollRef)
  const inner = Math.max(0, width - 32)
  const min = inner < 500 ? 150 : 190
  const cols = Math.max(2, Math.floor((inner + GAP) / (min + GAP)))
  const cardW = (inner - GAP * (cols - 1)) / cols
  const fileRowH = Math.round(cardW * 0.78) + 48 + GAP

  const rows = useMemo(() => {
    const folders = items.filter((i): i is DriveFolder => i.type === 'folder')
    const files = items.filter((i): i is DriveFile => i.type === 'file')
    const out: Row[] = []
    const both = folders.length > 0 && files.length > 0
    if (both) out.push({ type: 'header', label: t('browser.folders') })
    for (let i = 0; i < folders.length; i += cols) out.push({ type: 'folders', items: folders.slice(i, i + cols) })
    if (both) out.push({ type: 'header', label: t('browser.files') })
    for (let i = 0; i < files.length; i += cols) out.push({ type: 'files', items: files.slice(i, i + cols) })
    return out
  }, [items, cols, t])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === 'header' ? 40 : rows[i].type === 'folders' ? 56 + GAP : fileRowH),
    overscan: 4,
  })
  useEffect(() => virtualizer.measure(), [fileRowH, cols, virtualizer])

  return (
    <div className="relative px-4" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]
        return (
          <div key={v.key} className="absolute inset-x-4" style={{ top: v.start, height: v.size }}>
            {row.type === 'header' ? (
              <div className="flex h-full items-end pb-2 text-sm font-medium text-muted-foreground">{row.label}</div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP, height: v.size - GAP }}>
                {row.type === 'folders'
                  ? row.items.map((f) => <FolderTile key={f.key} folder={f} ordered={items} inTrash={inTrash} />)
                  : row.items.map((f) => <FileCard key={f.key} file={f} ordered={items} inTrash={inTrash} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ListView({ items, inTrash, scrollRef }: { items: DriveItem[]; inTrash: boolean; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const sortKey = useUi((s) => s.sortKey)
  const sortDir = useUi((s) => s.sortDir)
  const setSort = useUi((s) => s.setSort)
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => 48, overscan: 10 })
  const head = (key: SortKey, label: string, className: string) => (
    <button type="button" onClick={() => setSort(key)} className={cn('flex items-center gap-1 hover:text-foreground', className)}>
      {label}
      {sortKey === key && (sortDir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
    </button>
  )
  return (
    <div className="px-4">
      <div className="sticky top-0 z-10 flex h-10 items-center gap-3 border-b bg-background px-3 text-xs font-medium text-muted-foreground sm:px-4">
        <span className="size-5" />
        <span className="size-8" />
        {head('name', t('sort.name'), 'flex-1')}
        {head('date', inTrash ? t('trash.trashedAt') : t('sort.date'), 'hidden w-36 md:flex')}
        {head('size', t('sort.size'), 'hidden w-24 justify-end md:flex')}
        <span className="w-7" />
      </div>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div key={v.key} className="absolute inset-x-0" style={{ top: v.start, height: v.size }}>
            <ListRow item={items[v.index]} ordered={items} inTrash={inTrash} />
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ view }: { view: ViewKind }) {
  const { t } = useTranslation()
  const search = useUi((s) => s.search)
  const sync = useApp((s) => s.sync)
  const fileCount = useDrive((s) => s.index.fileCount + s.index.folders.size)
  if (sync.running && fileCount === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="font-medium">{t('browser.syncing')}</p>
        <Progress value={sync.total ? (sync.scanned / sync.total) * 100 : 0} indeterminate={!sync.total} />
        <p className="text-sm text-muted-foreground">{t('browser.scanned', { count: sync.scanned, total: sync.total ?? '?' })}</p>
      </div>
    )
  }
  const [Icon, title, hint] = search.trim()
    ? [FolderSearch, t('browser.noResults'), t('browser.noResultsHint')]
    : view.kind === 'trash'
      ? [Trash, t('trash.emptyState'), t('trash.emptyHint')]
      : view.kind === 'folder'
        ? [Inbox, t('browser.emptyFolder'), t('browser.emptyFolderHint')]
        : [Inbox, t('browser.emptyView'), '']
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-24 text-center">
      <div className="mb-2 grid size-20 place-items-center rounded-full bg-muted">
        <Icon className="size-9 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

function useShortcuts(items: DriveItem[], view: ViewKind) {
  const navigate = useNavigate()
  const index = useDrive((s) => s.index)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return
      const ui = useUi.getState()
      if (ui.dialog || ui.preview) return
      const selected = items.filter((i) => ui.selected.has(i.key))
      const inTrash = view.kind === 'trash'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        ui.select(items.map((i) => i.key))
      } else if (e.key === 'Escape') {
        ui.clearSelection()
      } else if (e.key === 'Delete' && selected.length) {
        if (inTrash) confirmDeleteForever(selected)
        else void trashWithUndo(selected)
      } else if (e.key === 'F2' && selected.length === 1 && !inTrash) {
        e.preventDefault()
        const actions = buildItemActions(selected, { inTrash, siblings: items, navigate })
        actions.find((a) => a.key === 'rename')?.onSelect()
      } else if (e.key === 'Enter' && selected.length === 1 && !inTrash) {
        buildItemActions(selected, { inTrash, siblings: items, navigate })
          .find((a) => a.key === 'open')
          ?.onSelect()
      } else if (e.key === 'Backspace' && view.kind === 'folder' && view.id) {
        const parent = index.folders.get(view.id)?.parentId ?? 0
        navigate(parent ? `/folder/${parent}` : '/')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, view, navigate, index])
}

export function Browser() {
  const { t } = useTranslation()
  const view = useCurrentView()
  const items = useViewItems(view)
  const viewMode = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const hasSelection = useUi((s) => s.selected.size > 0)
  const clearSelection = useUi((s) => s.clearSelection)
  const trashedCount = useDrive((s) => s.index.trashed.length)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inTrash = view.kind === 'trash'

  // Leaving a view drops its selection.
  useEffect(() => {
    clearSelection()
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view, clearSelection])

  useShortcuts(items, view)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 px-4 pt-3 pb-2">
        <div className="flex min-h-11 items-center justify-between gap-2">
          {hasSelection ? <SelectionBar items={items} view={view} /> : <div className="min-w-0 flex-1"><Header view={view} /></div>}
          <div className="flex shrink-0 items-center gap-1">
            {inTrash && trashedCount > 0 && !hasSelection && (
              <Button variant="outline" size="sm" onClick={confirmEmptyTrash}>
                {t('trash.empty')}
              </Button>
            )}
            {view.kind !== 'recent' && !inTrash && <SortMenu />}
            <Tip label={viewMode === 'grid' ? t('browser.listView') : t('browser.gridView')}>
              <Button variant="ghost" size="icon-sm" onClick={() => setView(viewMode === 'grid' ? 'list' : 'grid')} aria-label={t('browser.toggleView')}>
                {viewMode === 'grid' ? <List /> : <LayoutGrid />}
              </Button>
            </Tip>
          </div>
        </div>
        {inTrash ? <p className="px-2 text-xs text-muted-foreground">{t('trash.notice')}</p> : <FilterChips view={view} />}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto pb-24 scrollbar-thin"
        onClick={(e) => {
          // Items stop propagation; menu clicks arrive through portals and are not DOM descendants.
          if (e.currentTarget.contains(e.target as Node)) clearSelection()
        }}
        role="listbox"
        aria-multiselectable
      >
        {items.length === 0 ? (
          <EmptyState view={view} />
        ) : viewMode === 'grid' ? (
          <GridView items={items} inTrash={inTrash} scrollRef={scrollRef} />
        ) : (
          <ListView items={items} inTrash={inTrash} scrollRef={scrollRef} />
        )}
      </div>
    </div>
  )
}

