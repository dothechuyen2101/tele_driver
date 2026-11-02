import { useMemo, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  Archive,
  Import,
  Bookmark,
  ChevronRight,
  Clock,
  File,
  FileText,
  Film,
  Folder,
  FolderLock,
  HardDrive,
  Headphones,
  Image,
  Lock,
  LockOpen,
  Megaphone,
  Plus,
  Trash,
  Users,
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { chooseAnotherStorage } from '@/app/session'
import { lockVault } from '@/drive/vault'
import { useCurrentView } from '@/hooks/useView'
import { formatBytes } from '@/lib/format'
import type { Category } from '@/lib/mime'
import { cn } from '@/lib/utils'
import { useApp, useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { folderPath, type DriveFolder } from '@/drive/model'
import { Button } from '../ui/button'
import { NewMenu } from './NewMenu'

const SMART: { category: Category; icon: typeof Image; color: string }[] = [
  { category: 'image', icon: Image, color: 'text-rose-500' },
  { category: 'video', icon: Film, color: 'text-purple-500' },
  { category: 'audio', icon: Headphones, color: 'text-orange-500' },
  { category: 'document', icon: FileText, color: 'text-sky-600' },
  { category: 'archive', icon: Archive, color: 'text-amber-600' },
  { category: 'other', icon: File, color: 'text-muted-foreground' },
]

function NavItem({ to, icon, label, badge, dropId, folderId, end }: { to: string; icon: ReactNode; label: string; badge?: ReactNode; dropId?: string; folderId?: number; end?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `nodrop:${to}`, data: { folderId, trash: dropId === 'drop:trash' }, disabled: !dropId })
  const close = useUi((s) => s.setSidebarOpen)
  return (
    <NavLink
      ref={setNodeRef}
      to={to}
      end={end}
      onClick={() => close(false)}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-3 rounded-full px-3 text-sm transition-colors [&_svg]:size-4',
          isActive ? 'bg-primary/12 font-semibold text-primary' : 'text-foreground/80 hover:bg-accent',
          isOver && 'bg-primary/15 ring-2 ring-primary/40',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  )
}

function TreeNode({ folder, depth, isOpen, toggle, activeId }: { folder: DriveFolder; depth: number; isOpen: (id: number) => boolean; toggle: (id: number) => void; activeId: number }) {
  const navigate = useNavigate()
  const children = useDrive((s) => s.index.childFolders.get(folder.id))
  const live = useMemo(() => (children ?? []).filter((f) => !f.trashedAt).sort((a, b) => a.name.localeCompare(b.name)), [children])
  const open = isOpen(folder.id)
  const { setNodeRef, isOver } = useDroppable({ id: `drop:tree:${folder.id}`, data: { folderId: folder.id } })
  const close = useUi((s) => s.setSidebarOpen)
  return (
    <>
      <div
        ref={setNodeRef}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-full pr-3 text-sm transition-colors',
          activeId === folder.id ? 'bg-primary/12 font-medium text-primary' : 'text-foreground/80 hover:bg-accent',
          isOver && 'bg-primary/15 ring-2 ring-primary/40',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          navigate(`/folder/${folder.id}`)
          close(false)
        }}
      >
        <button
          type="button"
          aria-label="toggle"
          onClick={(e) => {
            e.stopPropagation()
            toggle(folder.id)
          }}
          className={cn('grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent', !live.length && 'invisible')}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        {folder.encrypted ? <FolderLock className="size-4 shrink-0 text-amber-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
        <span className="truncate">{folder.name}</span>
      </div>
      {open && live.map((c) => <TreeNode key={c.id} folder={c} depth={depth + 1} isOpen={isOpen} toggle={toggle} activeId={activeId} />)}
    </>
  )
}

function FolderTree() {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const view = useCurrentView()
  const activeId = view.kind === 'folder' ? view.id : -1
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [rootOpen, setRootOpen] = useState(true)

  // Ancestors of the open folder are shown expanded unless the user collapsed them.
  const revealed = useMemo(() => new Set(activeId > 0 ? folderPath(index, activeId).slice(0, -1).map((f) => f.id) : []), [index, activeId])
  const isOpen = (id: number) => (expanded.has(id) || revealed.has(id)) && !collapsed.has(id)

  const roots = useMemo(() => (index.childFolders.get(0) ?? []).filter((f) => !f.trashedAt).sort((a, b) => a.name.localeCompare(b.name)), [index])
  const toggle = (id: number) => {
    const open = isOpen(id)
    const without = (set: Set<number>) => {
      const next = new Set(set)
      next.delete(id)
      return next
    }
    const withId = (set: Set<number>) => new Set(set).add(id)
    setExpanded((prev) => (open ? without(prev) : withId(prev)))
    setCollapsed((prev) => (open ? withId(prev) : without(prev)))
  }

  return (
    <div>
      <div className="relative">
        <NavItem to="/" end icon={<HardDrive />} label={t('nav.myDrive')} dropId="drop:tree:0" folderId={0} />
        {roots.length > 0 && (
          <button
            type="button"
            aria-label="toggle"
            onClick={() => setRootOpen((v) => !v)}
            className="absolute top-2 right-2 grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', rootOpen && 'rotate-90')} />
          </button>
        )}
      </div>
      {rootOpen && (
        <div className="mt-0.5 max-h-[40vh] overflow-y-auto scrollbar-thin">
          {roots.map((f) => (
            <TreeNode key={f.id} folder={f} depth={1} isOpen={isOpen} toggle={toggle} activeId={activeId} />
          ))}
        </div>
      )}
    </div>
  )
}

function StorageCard() {
  const { t } = useTranslation()
  const storage = useApp((s) => s.storage)
  const index = useDrive((s) => s.index)
  const vaultKey = useDrive((s) => s.vaultKey)
  const openDialog = useUi((s) => s.openDialog)
  if (!storage) return null
  const Icon = storage.kind === 'self' ? Bookmark : storage.kind === 'channel' && storage.broadcast ? Megaphone : Users
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{storage.kind === 'self' ? t('storage.saved') : storage.title}</span>
        <button type="button" className="text-primary hover:underline" onClick={chooseAnotherStorage}>
          {t('common.change')}
        </button>
      </div>
      <div className="text-muted-foreground">
        {t('sidebar.usage', { count: index.fileCount, size: formatBytes(index.totalSize) })}
      </div>
      {index.vault && (
        <button
          type="button"
          onClick={() => (vaultKey ? void lockVault() : openDialog({ kind: 'vault', mode: 'unlock' }))}
          className="flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground"
        >
          {vaultKey ? <LockOpen className="size-3.5 text-emerald-500" /> : <Lock className="size-3.5" />}
          {vaultKey ? t('vault.unlockedClick') : t('vault.lockedClick')}
        </button>
      )}
    </div>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const trashed = useDrive((s) => s.index.trashed.length)
  return (
    <div className="flex h-full flex-col gap-4 px-3 py-3">
      <NewMenu>
        <Button size="lg" className="h-12 w-fit rounded-2xl px-5 shadow-md">
          <Plus className="size-5!" />
          {t('new.button')}
        </Button>
      </NewMenu>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        <FolderTree />
        <NavItem to="/recent" icon={<Clock />} label={t('nav.recent')} />
        <NavItem to="/import" icon={<Import />} label={t('nav.import')} />
        <div className="mt-3 mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t('nav.smart')}</div>
        {SMART.map(({ category, icon: Icon, color }) => (
          <NavItem key={category} to={`/smart/${category}`} icon={<Icon className={color} />} label={t(`category.${category}`)} />
        ))}
        <div className="mt-3" />
        <NavItem
          to="/trash"
          icon={<Trash />}
          label={t('nav.trash')}
          dropId="drop:trash"
          badge={trashed ? <span className="text-xs text-muted-foreground">{trashed}</span> : undefined}
        />
      </nav>
      <StorageCard />
    </div>
  )
}
