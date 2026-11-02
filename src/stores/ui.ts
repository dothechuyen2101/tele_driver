import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Category } from '@/lib/mime'
import type { DriveFile, DriveFolder, DriveItem } from '@/drive/model'

export type SortKey = 'name' | 'date' | 'size' | 'type'
export type SizeFilter = 'any' | 'lt1m' | '1m-100m' | '100m-1g' | 'gt1g'
export type DateFilter = 'any' | 'today' | '7d' | '30d' | 'year'

export interface Filters {
  type: Category | 'folder' | 'any'
  size: SizeFilter
  date: DateFilter
}

export const DEFAULT_FILTERS: Filters = { type: 'any', size: 'any', date: 'any' }

export type DialogState =
  | { kind: 'newFolder'; parentId: number }
  | { kind: 'rename'; item: DriveItem }
  | { kind: 'move'; items: DriveItem[] }
  | { kind: 'forward'; files: DriveFile[] }
  | { kind: 'confirm'; title: string; message: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void | Promise<void> }
  | { kind: 'settings'; tab?: 'general' | 'security' | 'storage' | 'account' }
  | { kind: 'vault'; mode: 'create' | 'unlock' | 'change'; then?: () => void }
  | { kind: 'details'; item: DriveItem }

interface UiState {
  view: 'grid' | 'list'
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  selected: Set<string>
  anchor?: string
  search: string
  filters: Filters
  /** When filters last changed; date filters are relative to it (keeps rendering pure). */
  filtersAt: number
  preview?: { key: string; keys: string[] }
  dialog: DialogState | null
  transfersOpen: boolean
  sidebarOpen: boolean
  setView: (v: 'grid' | 'list') => void
  setSort: (key: SortKey) => void
  select: (keys: string[], anchor?: string) => void
  toggle: (key: string) => void
  clearSelection: () => void
  setSearch: (s: string) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  openPreview: (key: string, keys: string[]) => void
  closePreview: () => void
  openDialog: (d: DialogState) => void
  closeDialog: () => void
  setTransfersOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      view: 'grid',
      sortKey: 'name',
      sortDir: 'asc',
      selected: new Set(),
      search: '',
      filters: DEFAULT_FILTERS,
      filtersAt: Date.now(),
      dialog: null,
      transfersOpen: true,
      sidebarOpen: false,
      setView: (view) => set({ view }),
      setSort: (key) => {
        const { sortKey, sortDir } = get()
        if (key === sortKey) set({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
        else set({ sortKey: key, sortDir: key === 'name' || key === 'type' ? 'asc' : 'desc' })
      },
      select: (keys, anchor) => set({ selected: new Set(keys), anchor: anchor ?? keys[keys.length - 1] }),
      toggle: (key) => {
        const next = new Set(get().selected)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        set({ selected: next, anchor: key })
      },
      clearSelection: () => set({ selected: new Set(), anchor: undefined }),
      setSearch: (search) => set({ search }),
      setFilters: (f) => set({ filters: { ...get().filters, ...f }, filtersAt: Date.now() }),
      resetFilters: () => set({ filters: DEFAULT_FILTERS, filtersAt: Date.now() }),
      openPreview: (key, keys) => set({ preview: { key, keys } }),
      closePreview: () => set({ preview: undefined }),
      openDialog: (dialog) => set({ dialog }),
      closeDialog: () => set({ dialog: null }),
      setTransfersOpen: (transfersOpen) => set({ transfersOpen }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'td-ui',
      partialize: (s) => ({ view: s.view, sortKey: s.sortKey, sortDir: s.sortDir }),
    },
  ),
)

export function itemKey(item: DriveFolder | DriveFile) {
  return item.key
}
