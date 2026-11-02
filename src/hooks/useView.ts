import { useMemo } from 'react'
import { useLocation, useMatch } from 'react-router'
import { CATEGORIES, type Category } from '@/lib/mime'
import { foldText } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { useUi, type Filters, type SortKey } from '@/stores/ui'
import { isFolderTrashed, liveFiles, type DriveFolder, type DriveIndex, type DriveItem } from '@/drive/model'

export type ViewKind = { kind: 'folder'; id: number } | { kind: 'smart'; category: Category } | { kind: 'recent' } | { kind: 'trash' }

/** Works anywhere inside the router, not only inside a matched <Route>. */
export function useCurrentView(): ViewKind {
  const folderMatch = useMatch('/folder/:id')
  const smartMatch = useMatch('/smart/:category')
  const { pathname } = useLocation()
  const category = smartMatch?.params.category as Category | undefined
  const rawId = Number(folderMatch?.params.id)
  const id = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : 0
  const kind = pathname.startsWith('/trash')
    ? 'trash'
    : pathname.startsWith('/recent')
      ? 'recent'
      : category && CATEGORIES.includes(category)
        ? 'smart'
        : 'folder'
  return useMemo<ViewKind>(() => {
    if (kind === 'trash' || kind === 'recent') return { kind }
    if (kind === 'smart') return { kind, category: category! }
    return { kind: 'folder', id }
  }, [kind, category, id])
}

const DAY = 86400

function passesFilters(item: DriveItem, f: Filters, nowSec: number) {
  if (f.type !== 'any') {
    if (f.type === 'folder') {
      if (item.type !== 'folder') return false
    } else if (item.type !== 'file' || item.category !== f.type) return false
  }
  if (f.size !== 'any') {
    if (item.type !== 'file') return false
    const s = item.size
    const MB = 1024 * 1024
    if (f.size === 'lt1m' && s >= MB) return false
    if (f.size === '1m-100m' && (s < MB || s >= 100 * MB)) return false
    if (f.size === '100m-1g' && (s < 100 * MB || s >= 1024 * MB)) return false
    if (f.size === 'gt1g' && s < 1024 * MB) return false
  }
  if (f.date !== 'any') {
    const age = nowSec - item.date
    if (f.date === 'today' && age > DAY) return false
    if (f.date === '7d' && age > 7 * DAY) return false
    if (f.date === '30d' && age > 30 * DAY) return false
    if (f.date === 'year' && age > 365 * DAY) return false
  }
  return true
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortItems(items: DriveItem[], key: SortKey, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    let r = 0
    if (key === 'date') r = a.date - b.date
    else if (key === 'size') r = (a.type === 'file' ? a.size : 0) - (b.type === 'file' ? b.size : 0)
    else if (key === 'type') r = collator.compare(a.type === 'file' ? a.category + a.mime : '', b.type === 'file' ? b.category + b.mime : '')
    if (r === 0) r = collator.compare(a.name, b.name)
    return r * sign
  })
}

function liveFolders(index: DriveIndex): DriveFolder[] {
  const out: DriveFolder[] = []
  for (const f of index.folders.values()) if (!isFolderTrashed(index, f.id)) out.push(f)
  return out
}

/** Items visible in the current view, after search, filters and sorting. */
export function useViewItems(view: ViewKind): DriveItem[] {
  const index = useDrive((s) => s.index)
  const search = useUi((s) => s.search)
  const filters = useUi((s) => s.filters)
  const filtersAt = useUi((s) => s.filtersAt)
  const sortKey = useUi((s) => s.sortKey)
  const sortDir = useUi((s) => s.sortDir)

  return useMemo(() => {
    const nowSec = filtersAt / 1000
    let items: DriveItem[]
    const q = foldText(search.trim())
    if (view.kind === 'trash') items = [...index.trashed]
    else if (q) {
      items = [...liveFolders(index), ...liveFiles(index)].filter((i) => foldText(i.name).includes(q))
    } else if (view.kind === 'folder') {
      const folders = (index.childFolders.get(view.id) ?? []).filter((f) => !f.trashedAt)
      const files = (index.childFiles.get(view.id) ?? []).filter((f) => !f.trashedAt)
      items = [...folders, ...files]
    } else if (view.kind === 'smart') items = liveFiles(index).filter((f) => f.category === view.category)
    else items = liveFiles(index)

    items = items.filter((i) => passesFilters(i, filters, nowSec))
    if (view.kind === 'recent' && !q) return [...items].sort((a, b) => b.date - a.date).slice(0, 300)
    if (view.kind === 'trash') return [...items].sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    return sortItems(items, sortKey, sortDir)
  }, [index, view, search, filters, filtersAt, sortKey, sortDir])
}

/** Folder that uploads and "New folder" target: the open folder, or the root for other views. */
export function useCurrentFolderId() {
  const view = useCurrentView()
  return view.kind === 'folder' ? view.id : 0
}
