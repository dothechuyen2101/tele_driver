import { useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Folder, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { folderPath, isFolderEncrypted } from '@/drive/model'
import { needsEncryption } from '@/drive/uploads'
import { formatBytes, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

import type { TargetState } from './helpers'

export function FolderTarget({ value, onChange }: { value: TargetState; onChange: (v: TargetState) => void }) {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const openDialog = useUi((s) => s.openDialog)
  const path = [t('nav.myDrive'), ...folderPath(index, value.parentId).map((f) => f.name)].join(' / ')
  const encrypted = isFolderEncrypted(index, value.parentId) || needsEncryption(value.parentId)
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t('imports.target')}</span>
      <div className="flex items-center gap-2 rounded-lg border p-2.5">
        {encrypted ? <Lock className="size-4 shrink-0 text-emerald-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
        <span className="min-w-0 flex-1 truncate text-sm">{path}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            openDialog({
              kind: 'pickFolder',
              title: t('imports.target'),
              confirmLabel: t('imports.chooseHere'),
              initial: value.parentId,
              onPick: (parentId) => onChange({ ...value, parentId }),
            })
          }
        >
          {t('common.change')}
        </Button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={value.createSub} onChange={(e) => onChange({ ...value, createSub: e.target.checked })} />
        {t('imports.createSub')}
        <Input className="h-8 min-w-40 flex-1" value={value.subfolder} disabled={!value.createSub} onChange={(e) => onChange({ ...value, subfolder: e.target.value })} maxLength={200} />
      </label>
      {encrypted && <p className="text-xs text-muted-foreground">{t('imports.encryptedTarget')}</p>}
    </div>
  )
}

export interface PickRow {
  key: string
  name: string
  /** -1 when unknown. */
  size: number
  date?: number
  icon: ReactNode
  /** Why the row cannot be imported, or that it is already in the drive. */
  note?: string
  disabled?: boolean
}

/** Virtualized checkbox list for thousands of candidate files. */
export function PickList({ rows, selected, onToggle }: { rows: PickRow[]; selected: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is not React Compiler aware
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 44, overscan: 12 })
  return (
    <div ref={ref} className="h-80 overflow-y-auto rounded-lg border scrollbar-thin">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const r = rows[v.index]
          return (
            <label
              key={r.key}
              className={cn('absolute inset-x-0 flex h-11 items-center gap-3 border-b px-3 text-sm', r.disabled ? 'opacity-50' : 'cursor-pointer hover:bg-accent/50')}
              style={{ top: v.start }}
            >
              <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.has(r.key)} disabled={r.disabled} onChange={() => onToggle(r.key)} />
              <span className="shrink-0 [&_svg]:size-4">{r.icon}</span>
              <span className="min-w-0 flex-1 truncate" title={r.name}>
                {r.name}
              </span>
              {r.note && <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">{r.note}</span>}
              {r.date ? <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:inline">{formatDate(r.date)}</span> : null}
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{r.size >= 0 ? formatBytes(r.size) : '—'}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export function SelectionBar({ total, selected, size, onAll, onNone, extra }: { total: number; selected: number; size: number; onAll: () => void; onNone: () => void; extra?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium">{t('imports.selectedSummary', { count: selected, total, size: formatBytes(size) })}</span>
      <Button variant="link" size="sm" className="h-auto px-0" onClick={onAll}>
        {t('imports.selectAll')}
      </Button>
      <Button variant="link" size="sm" className="h-auto px-0" onClick={onNone}>
        {t('imports.selectNone')}
      </Button>
      {extra}
    </div>
  )
}
