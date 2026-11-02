/**
 * Persistent import queue. Jobs and their items live in IndexedDB so an import
 * of thousands of files survives reloads; one job runs at a time and shows up
 * as a single row in the transfer panel.
 */
import { db, type ImportItemRow, type ImportJobRow, type ImportStatus } from '@/db/db'
import { randomId } from '@/lib/bytes'
import { errorMessage } from '@/lib/utils'
import { requireStorage, useApp, useDrive } from '@/stores/app'
import { useTransfers } from '@/stores/transfers'
import { currentToken, GoogleAuthError } from '@/google/auth'
import { driveSource } from '@/google/drive'
import { isRpc, rpcError, SESSION_DEAD } from '@/telegram/errors'
import { chatKeyOf } from '@/telegram/peers'
import { applyFields } from '../ops'
import { resolveFolderPath, uploadImportSource } from '../uploads'
import { importTelegramItem, SkipError } from './telegram'

export type NewImportJob = Pick<ImportJobRow, 'kind' | 'title' | 'folderId' | 'encrypt' | 'keepCaptions' | 'peer' | 'sub'>
export type NewImportItem = Omit<ImportItemRow, 'jobId' | 'idx' | 'state'>

/** Statuses a job can still progress from on its own. */
export const ACTIVE: ImportStatus[] = ['queued', 'running', 'waiting']

export async function createImport(job: NewImportJob, items: NewImportItem[]) {
  const { ref } = requireStorage()
  const id = randomId(12)
  const now = Date.now()
  const row: ImportJobRow = { ...job, id, chatKey: chatKeyOf(ref), status: 'queued', total: items.length, done: 0, skipped: 0, failed: 0, createdAt: now, updatedAt: now }
  await db.transaction('rw', db.imports, db.importItems, async () => {
    await db.imports.put(row)
    await db.importItems.bulkPut(items.map((it, idx) => ({ ...it, jobId: id, idx, state: 'pending' as const })))
  })
  kickImports()
  return id
}

type StopReason = 'pause' | 'cancel' | 'stop'
let loop: Promise<void> | null = null
let current: { id: string; abort: AbortController; reason?: StopReason } | null = null

/** Starts working through queued jobs of the open storage (no-op if already running). */
export function kickImports() {
  if (!loop) {
    loop = runLoop()
      .catch((err) => console.warn('import loop', err))
      .finally(() => {
        loop = null
      })
  }
}

/** Interrupts the running job without changing its status (lock, logout, storage switch). */
export function stopImports() {
  if (current) {
    current.reason = 'stop'
    current.abort.abort()
  }
}

async function setJob(id: string, patch: Partial<ImportJobRow>) {
  await db.imports.update(id, { ...patch, updatedAt: Date.now() })
}

function interrupt(id: string, reason: StopReason) {
  if (current?.id === id) {
    current.reason = reason
    current.abort.abort()
  }
}

export async function pauseImport(id: string) {
  await setJob(id, { status: 'paused', waitUntil: undefined })
  interrupt(id, 'pause')
}

export async function resumeImport(id: string) {
  await setJob(id, { status: 'queued', error: undefined, waitUntil: undefined })
  kickImports()
}

export async function cancelImport(id: string) {
  await setJob(id, { status: 'canceled', waitUntil: undefined })
  interrupt(id, 'cancel')
}

export async function retryFailed(id: string) {
  await db.transaction('rw', db.imports, db.importItems, async () => {
    await db.importItems.where('[jobId+state]').equals([id, 'failed']).modify({ state: 'pending', reason: undefined })
    await setJob(id, { status: 'queued', failed: 0, error: undefined })
  })
  kickImports()
}

export async function removeImport(id: string) {
  interrupt(id, 'cancel')
  await db.transaction('rw', db.imports, db.importItems, async () => {
    await db.importItems.where('jobId').equals(id).delete()
    await db.imports.delete(id)
  })
  useTransfers.getState().update(`import:${id}`, { status: 'canceled' })
}

async function runLoop() {
  for (;;) {
    const { storage, phase } = useApp.getState()
    if (!storage || phase !== 'ready') return
    const jobs = await db.imports.where('chatKey').equals(chatKeyOf(storage)).toArray()
    const next = jobs.filter((j) => ACTIVE.includes(j.status)).sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!next) return
    const outcome = await runJob(next)
    if (outcome === 'stopped') return
  }
}

/** Seconds Telegram asked us to wait, if the error is a flood wait. */
function floodSeconds(err: unknown) {
  const code = rpcError(err) ?? ''
  if (!code.startsWith('FLOOD')) return 0
  return (err as { seconds?: number }).seconds || Number(code.split('_').pop()) || 30
}

function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

async function importDriveItem(item: ImportItemRow, folderId: number, encrypt: boolean, signal: AbortSignal) {
  const getToken = () => {
    const token = currentToken('file')
    if (!token) throw new GoogleAuthError()
    return token
  }
  const src = await driveSource(
    { fileId: item.fileId!, name: item.name, mime: item.mime, size: item.size, dir: item.dir ?? '', exportMime: item.exportMime },
    getToken,
    signal,
  )
  await uploadImportSource(src, folderId, { encrypt, signal, onBytes: () => {} })
}

/** Moves a followed source's bookmark forward once its import job finished. */
async function advanceSubscription(sub: { msgId: number; last: number }) {
  const s = useDrive.getState().index.subs.find((x) => x.msgId === sub.msgId)
  if (!s || s.last >= sub.last) return
  await applyFields(s.entry, { l: String(sub.last), t: String(Math.floor(Date.now() / 1000)) })
}

async function runJob(job: ImportJobRow): Promise<ImportStatus | 'stopped'> {
  const abort = new AbortController()
  const me: { id: string; abort: AbortController; reason?: StopReason } = { id: job.id, abort }
  current = me
  const tid = `import:${job.id}`
  const transfers = useTransfers.getState()
  if (transfers.items.some((t) => t.id === tid)) transfers.update(tid, { status: 'running', abort, error: undefined })
  else transfers.add({ id: tid, kind: 'import', unit: 'items', name: job.title, size: job.total, encrypted: job.encrypt, abort, status: 'running' })
  const counts = { done: job.done, skipped: job.skipped, failed: job.failed }
  const showProgress = (detail?: string) => useTransfers.getState().update(tid, { done: counts.done + counts.skipped + counts.failed, detail })
  showProgress()

  const blocked = (status: ImportStatus, error: string) => {
    useTransfers.getState().update(tid, { status: 'error', error })
    return setJob(job.id, { status, error }).then(() => status)
  }
  if (job.encrypt && !useDrive.getState().vaultKey) return blocked('paused', 'VAULT_LOCKED')
  if (job.kind === 'gd' && !currentToken('file')) return blocked('needs-auth', 'GOOGLE_AUTH')
  await setJob(job.id, { status: 'running', error: undefined })

  const folders = new Map<string, number>()
  let outcome: ImportStatus = 'done'
  let error: string | undefined
  try {
    const pending = await db.importItems.where('[jobId+state]').equals([job.id, 'pending']).sortBy('idx')
    for (const item of pending) {
      abort.signal.throwIfAborted()
      showProgress(item.name)
      const finish = async (state: 'done' | 'skipped' | 'failed', reason?: string) => {
        await db.importItems.update([job.id, item.idx], { state, reason })
        counts[state]++
        await setJob(job.id, counts)
        showProgress()
      }
      if (useDrive.getState().index.sources.has(item.key)) {
        await finish('skipped', 'duplicate')
        continue
      }
      for (;;) {
        try {
          const dirs = item.dir?.split('/').filter(Boolean) ?? []
          const folderId = dirs.length ? await resolveFolderPath(job.folderId, dirs, folders) : job.folderId
          if (job.kind === 'tg') await importTelegramItem(job, item, folderId, abort.signal, () => {})
          else await importDriveItem(item, folderId, job.encrypt, abort.signal)
          await finish('done')
          break
        } catch (err) {
          if (abort.signal.aborted) throw err
          if (err instanceof SkipError) {
            await finish('skipped', err.reason)
            break
          }
          if (err instanceof Error && err.message === 'EMPTY_FILE') {
            await finish('skipped', 'empty')
            break
          }
          const wait = floodSeconds(err)
          if (wait) {
            await setJob(job.id, { status: 'waiting', waitUntil: Date.now() + wait * 1000 })
            showProgress(`FLOOD_WAIT_${wait}`)
            await abortableSleep(wait * 1000, abort.signal)
            await setJob(job.id, { status: 'running', waitUntil: undefined })
            continue
          }
          if (err instanceof GoogleAuthError || isRpc(err, ...SESSION_DEAD) || errorMessage(err) === 'VAULT_LOCKED') throw err
          await finish('failed', rpcError(err) ?? errorMessage(err))
          break
        }
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      if (me.reason === 'stop') return 'stopped'
      outcome = me.reason === 'pause' ? 'paused' : 'canceled'
    } else if (err instanceof GoogleAuthError) {
      outcome = 'needs-auth'
      error = 'GOOGLE_AUTH'
    } else {
      outcome = errorMessage(err) === 'VAULT_LOCKED' ? 'paused' : 'error'
      error = rpcError(err) ?? errorMessage(err)
    }
  } finally {
    if (current === me) current = null
  }

  await setJob(job.id, { status: outcome, error, waitUntil: undefined })
  if (outcome === 'done' && job.sub) await advanceSubscription(job.sub).catch((e) => console.warn('subscription bookmark', e))
  useTransfers.getState().update(tid, {
    status: outcome === 'done' ? 'done' : outcome === 'paused' || outcome === 'canceled' ? 'canceled' : 'error',
    error,
    detail: undefined,
  })
  return outcome
}
