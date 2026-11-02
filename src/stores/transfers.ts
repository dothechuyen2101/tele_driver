import { create } from 'zustand'

export type TransferStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface Transfer {
  id: string
  kind: 'upload' | 'download'
  name: string
  size: number
  done: number
  status: TransferStatus
  error?: string
  encrypted?: boolean
  /** Moving average, bytes per second. */
  speed: number
  createdAt: number
  abort: AbortController
  retry?: () => void
}

interface TransfersState {
  items: Transfer[]
  add: (t: Omit<Transfer, 'done' | 'speed' | 'createdAt' | 'status'> & { status?: TransferStatus }) => void
  update: (id: string, patch: Partial<Transfer>) => void
  progress: (id: string, bytes: number) => void
  cancel: (id: string) => void
  clearFinished: () => void
}

const lastTick = new Map<string, { t: number; done: number }>()

export const useTransfers = create<TransfersState>((set, get) => ({
  items: [],
  add: (t) => set({ items: [{ ...t, status: t.status ?? 'queued', done: 0, speed: 0, createdAt: Date.now() }, ...get().items] }),
  update: (id, patch) => set({ items: get().items.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
  progress: (id, bytes) => {
    const now = performance.now()
    set({
      items: get().items.map((x) => {
        if (x.id !== id) return x
        const done = Math.min(x.size || Infinity, x.done + bytes)
        const prev = lastTick.get(id)
        let speed = x.speed
        if (!prev) lastTick.set(id, { t: now, done })
        else if (now - prev.t > 700) {
          const inst = ((done - prev.done) * 1000) / (now - prev.t)
          speed = speed ? speed * 0.6 + inst * 0.4 : inst
          lastTick.set(id, { t: now, done })
        }
        return { ...x, done, speed }
      }),
    })
  },
  cancel: (id) => {
    const t = get().items.find((x) => x.id === id)
    if (!t) return
    t.abort.abort()
    if (t.status === 'queued' || t.status === 'running') get().update(id, { status: 'canceled' })
  },
  clearFinished: () => set({ items: get().items.filter((x) => x.status === 'queued' || x.status === 'running') }),
}))
