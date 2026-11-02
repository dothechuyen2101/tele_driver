import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, HardDrive, History, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { withVault } from '@/app/actions'
import { db, type ImportJobRow } from '@/db/db'
import { cancelImport, removeImport, resumeImport, retryFailed, pauseImport } from '@/drive/imports/runner'
import { requestToken } from '@/google/auth'
import { formatDate } from '@/lib/format'
import { describeError, reportError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { chatKeyOf } from '@/telegram/peers'
import { Button } from '../ui/button'
import { Progress } from '../ui/misc'
import { reasonLabel } from './helpers'

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function Problems({ jobId }: { jobId: string }) {
  const { t } = useTranslation()
  const items = useLiveQuery(async () => {
    const failed = await db.importItems.where('[jobId+state]').equals([jobId, 'failed']).limit(300).toArray()
    const skipped = await db.importItems.where('[jobId+state]').equals([jobId, 'skipped']).limit(300).toArray()
    return [...failed, ...skipped]
  }, [jobId])
  if (!items?.length) return <p className="text-xs text-muted-foreground">{t('imports.history.noProblems')}</p>
  return (
    <ul className="max-h-60 overflow-y-auto rounded-lg border text-xs scrollbar-thin">
      {items.map((i) => (
        <li key={i.idx} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
          <span className={cn('w-14 shrink-0', i.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{t(`imports.history.${i.state}`)}</span>
          <span className="min-w-0 flex-1 truncate">{i.name}</span>
          <span className="max-w-[45%] truncate text-muted-foreground">{reasonLabel(i.reason)}</span>
        </li>
      ))}
    </ul>
  )
}

function JobRow({ job }: { job: ImportJobRow }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const now = useNow(job.status === 'waiting')
  const processed = job.done + job.skipped + job.failed
  const active = job.status === 'running' || job.status === 'queued' || job.status === 'waiting'
  const run = (fn: () => Promise<unknown>) => void fn().catch((err) => reportError(err))
  const Icon = job.kind === 'gd' ? HardDrive : Send

  return (
    <div className="grid gap-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{job.title}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(job.createdAt / 1000, true)} · {t('imports.history.counts', { done: job.done, skipped: job.skipped, failed: job.failed, total: job.total })}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            job.status === 'done' ? 'bg-success/15 text-success' : job.status === 'error' || job.status === 'needs-auth' ? 'bg-destructive/10 text-destructive' : active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {job.status === 'waiting' && job.waitUntil
            ? t('imports.history.waiting', { seconds: Math.max(0, Math.ceil((job.waitUntil - now) / 1000)) })
            : t(`imports.status.${job.status}`)}
        </span>
      </div>
      {processed < job.total && <Progress value={(processed / Math.max(1, job.total)) * 100} />}
      {job.error && <p className="text-xs text-destructive">{describeError(new Error(job.error))}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {active && (
          <>
            <Button variant="outline" size="sm" onClick={() => run(() => pauseImport(job.id))}>
              {t('imports.pause')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => run(() => cancelImport(job.id))}>
              {t('common.cancel')}
            </Button>
          </>
        )}
        {job.status === 'needs-auth' && (
          <Button size="sm" onClick={() => run(() => requestToken('file').then(() => resumeImport(job.id)))}>
            {t('imports.history.reconnectGoogle')}
          </Button>
        )}
        {(job.status === 'paused' || job.status === 'canceled' || job.status === 'error') && processed < job.total && (
          <Button size="sm" onClick={() => (job.error === 'VAULT_LOCKED' ? withVault(() => resumeImport(job.id)) : run(() => resumeImport(job.id)))}>
            {t('imports.resume')}
          </Button>
        )}
        {job.failed > 0 && !active && (
          <Button variant="outline" size="sm" onClick={() => run(() => retryFailed(job.id))}>
            {t('imports.history.retryFailed')}
          </Button>
        )}
        {!active && (
          <Button variant="ghost" size="sm" onClick={() => run(() => removeImport(job.id))}>
            {t('imports.history.remove')}
          </Button>
        )}
        {(job.failed > 0 || job.skipped > 0) && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen((v) => !v)}>
            {t('imports.history.details')}
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        )}
      </div>
      {open && <Problems jobId={job.id} />}
    </div>
  )
}

export function ImportHistory() {
  const { t } = useTranslation()
  const storage = useApp((s) => s.storage)
  const chatKey = storage ? chatKeyOf(storage) : ''
  const jobs = useLiveQuery(() => db.imports.where('chatKey').equals(chatKey).reverse().sortBy('createdAt'), [chatKey])
  if (!jobs?.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <History className="size-9 text-muted-foreground" />
        <p className="font-medium">{t('imports.history.empty')}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('imports.history.notice')}</p>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  )
}
