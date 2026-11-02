import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, CircleAlert, CircleCheck, Lock, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes, formatEta, formatSpeed } from '@/lib/format'
import { describeError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useTransfers, type Transfer } from '@/stores/transfers'
import { useUi } from '@/stores/ui'
import { Progress, Tip } from '../ui/misc'

function Row({ t: item }: { t: Transfer }) {
  const { t } = useTranslation()
  const cancel = useTransfers((s) => s.cancel)
  const pct = item.size ? (item.done / item.size) * 100 : 0
  const active = item.status === 'running' || item.status === 'queued'
  const Icon = item.kind === 'upload' ? ArrowUpFromLine : ArrowDownToLine
  return (
    <div className="grid gap-1.5 border-b px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
          {item.name}
        </span>
        {item.encrypted && <Lock className="size-3.5 shrink-0 text-emerald-500" />}
        {item.status === 'done' && <CircleCheck className="size-4 shrink-0 text-success" />}
        {item.status === 'error' && (
          <Tip label={describeError(new Error(item.error))}>
            <CircleAlert className="size-4 shrink-0 text-destructive" />
          </Tip>
        )}
        {item.status === 'error' && item.retry && (
          <Tip label={t('common.retry')}>
            <button type="button" onClick={item.retry} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <RotateCcw className="size-4" />
            </button>
          </Tip>
        )}
        {active && (
          <Tip label={t('common.cancel')}>
            <button type="button" onClick={() => cancel(item.id)} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          </Tip>
        )}
      </div>
      {active && (
        <>
          <Progress value={pct} indeterminate={item.status === 'queued' || (!item.size && item.done === 0)} />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              {item.status === 'queued' ? t('transfers.queued') : `${formatBytes(item.done)} / ${formatBytes(item.size)}`}
            </span>
            {item.status === 'running' && item.speed > 0 && (
              <span>
                {formatSpeed(item.speed)} · {formatEta((item.size - item.done) / item.speed)}
              </span>
            )}
          </div>
        </>
      )}
      {item.status === 'error' && <p className="truncate text-[11px] text-destructive">{describeError(new Error(item.error))}</p>}
      {item.status === 'canceled' && <p className="text-[11px] text-muted-foreground">{t('transfers.canceled')}</p>}
    </div>
  )
}

export function TransferPanel() {
  const { t } = useTranslation()
  const items = useTransfers((s) => s.items)
  const clearFinished = useTransfers((s) => s.clearFinished)
  const open = useUi((s) => s.transfersOpen)
  const setOpen = useUi((s) => s.setTransfersOpen)
  if (!items.length) return null
  const active = items.filter((i) => i.status === 'running' || i.status === 'queued')
  const failed = items.filter((i) => i.status === 'error').length
  const title = active.length
    ? t('transfers.active', { count: active.length })
    : failed
      ? t('transfers.failed', { count: failed })
      : t('transfers.done', { count: items.length })
  const totalPct = active.length ? (active.reduce((n, i) => n + i.done, 0) / Math.max(1, active.reduce((n, i) => n + i.size, 0))) * 100 : 100

  return (
    <div className="fixed right-0 bottom-0 z-40 w-full overflow-hidden border bg-popover shadow-2xl sm:right-4 sm:bottom-4 sm:w-[380px] sm:rounded-xl">
      <div className="flex h-12 items-center gap-2 bg-secondary/70 px-4">
        <span className="flex-1 text-sm font-medium">{title}</span>
        <button type="button" onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-accent" aria-label={t('transfers.toggle')}>
          <ChevronDown className={cn('size-4 transition-transform', !open && 'rotate-180')} />
        </button>
        {!active.length && (
          <button type="button" onClick={clearFinished} className="rounded p-1 hover:bg-accent" aria-label={t('common.close')}>
            <X className="size-4" />
          </button>
        )}
      </div>
      {!open && active.length > 0 && <Progress value={totalPct} className="h-1 rounded-none" />}
      {open && <div className="max-h-80 overflow-y-auto scrollbar-thin">{items.map((i) => <Row key={i.id} t={i} />)}</div>}
    </div>
  )
}
