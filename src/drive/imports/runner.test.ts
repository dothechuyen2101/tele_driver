import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { EMPTY_INDEX } from '@/drive/model'
import { useApp, useDrive } from '@/stores/app'

const importTelegramItem = vi.fn()

vi.mock('./telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telegram')>()
  return { ...actual, importTelegramItem: (...args: unknown[]) => importTelegramItem(...args) }
})

const { createImport, pauseImport, resumeImport } = await import('./runner')

async function waitFor<T>(fn: () => Promise<T | undefined>, timeout = 8000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v !== undefined) return v
    if (Date.now() - start > timeout) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const jobDone = (id: string, status = 'done') => waitFor(async () => {
  const j = await db.imports.get(id)
  return j?.status === status ? j : undefined
})

const job = { kind: 'tg' as const, title: 'News', folderId: 0, encrypt: false, keepCaptions: true, peer: { key: 'c1', accessHash: '1', title: 'News' } }
const item = (n: number) => ({ key: `tg:c1:${n}`, name: `f${n}.pdf`, size: 10, mime: 'application/pdf', msgId: n })

describe('import runner', () => {
  beforeEach(async () => {
    importTelegramItem.mockReset()
    await db.imports.clear()
    await db.importItems.clear()
    useApp.setState({ phase: 'ready', storage: { kind: 'self', title: 'Saved' }, me: { id: '1', firstName: 'A', premium: false } })
    useDrive.setState({ index: { ...EMPTY_INDEX, sources: new Map([['tg:c1:2', 'm:99']]) } })
  })

  it('imports in order, skips duplicates and sits out flood waits', async () => {
    let floods = 0
    importTelegramItem.mockImplementation(async (_job, it: { msgId: number }) => {
      if (it.msgId === 3 && floods++ === 0) throw Object.assign(new Error('FLOOD'), { errorMessage: 'FLOOD_WAIT_1', seconds: 1 })
    })
    const id = await createImport(job, [item(1), item(2), item(3)])
    const done = await jobDone(id)
    expect(done).toMatchObject({ done: 2, skipped: 1, failed: 0, total: 3 })
    expect(importTelegramItem.mock.calls.map((c) => c[1].msgId)).toEqual([1, 3, 3])
    const skipped = await db.importItems.get([id, 1])
    expect(skipped).toMatchObject({ state: 'skipped', reason: 'duplicate' })
  })

  it('records failures and skip reasons without stopping the job', async () => {
    const { SkipError } = await import('./telegram')
    importTelegramItem.mockImplementation(async (_job, it: { msgId: number }) => {
      if (it.msgId === 1) throw new SkipError('protected')
      if (it.msgId === 3) throw new Error('MEDIA_EMPTY')
    })
    const id = await createImport(job, [item(1), item(3), item(4)])
    const done = await jobDone(id)
    expect(done).toMatchObject({ done: 1, skipped: 1, failed: 1 })
    expect(await db.importItems.get([id, 1])).toMatchObject({ state: 'failed', reason: 'MEDIA_EMPTY' })
  })

  it('pauses and resumes where it left off', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    importTelegramItem.mockImplementation(async (_job, it: { msgId: number }, _f, signal: AbortSignal) => {
      if (it.msgId === 4) {
        await Promise.race([gate, new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))])
      }
    })
    const id = await createImport(job, [item(1), item(4), item(5)])
    await waitFor(async () => (importTelegramItem.mock.calls.length >= 2 ? true : undefined))
    await pauseImport(id)
    const paused = await jobDone(id, 'paused')
    expect(paused.done).toBe(1)
    release()
    await resumeImport(id)
    const done = await jobDone(id)
    expect(done).toMatchObject({ done: 3, skipped: 0, failed: 0 })
  })
})
