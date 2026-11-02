/**
 * Page side of the service-worker streaming bridge. The page registers a byte
 * source under a random token; when the browser requests
 * `/__td/stream/<token>` (video/audio, with Range) or `/__td/download/<token>`,
 * the service worker asks this page for bytes over a MessageChannel, one chunk
 * per pull, so nothing is buffered beyond what the consumer reads.
 */
import { randomId } from './bytes'
import { errorMessage } from './utils'

export interface StreamSource {
  name: string
  mime: string
  size?: number
  attachment: boolean
  open: (start: number, end: number | undefined, signal: AbortSignal) => AsyncIterator<Uint8Array>
  onBytes?: (n: number) => void
  onDone?: () => void
  onError?: (err: unknown) => void
}

const sources = new Map<string, StreamSource>()
let listening = false
let active = 0
let pingTimer: ReturnType<typeof setInterval> | undefined

export function streamingAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller
}

function ping() {
  navigator.serviceWorker.controller?.postMessage({ type: 'td-ping' })
}

function setActive(delta: number) {
  active += delta
  if (active > 0 && !pingTimer) pingTimer = setInterval(ping, 15_000)
  if (active <= 0 && pingTimer) {
    clearInterval(pingTimer)
    pingTimer = undefined
  }
}

function serve(port: MessagePort, token: string, start: number, end: number | undefined) {
  const src = sources.get(token)
  if (!src) {
    port.postMessage({ type: 'error', message: 'GONE' })
    return
  }
  const ac = new AbortController()
  const it = src.open(start, end, ac.signal)
  let finished = false
  setActive(1)
  const finish = () => {
    if (finished) return
    finished = true
    setActive(-1)
    port.close()
  }
  port.onmessage = async (m: MessageEvent) => {
    if (finished) return
    if (m.data?.type === 'pull') {
      try {
        const r = await it.next()
        if (r.done) {
          port.postMessage({ type: 'end' })
          src.onDone?.()
          finish()
          return
        }
        const copy = r.value.slice()
        port.postMessage({ type: 'chunk', data: copy.buffer }, [copy.buffer])
        src.onBytes?.(r.value.length)
      } catch (err) {
        port.postMessage({ type: 'error', message: errorMessage(err) })
        if (!ac.signal.aborted) src.onError?.(err)
        finish()
      }
    } else if (m.data?.type === 'cancel') {
      ac.abort()
      void it.return?.(undefined)
      finish()
    }
  }
}

function ensureListener() {
  if (listening) return
  listening = true
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'td-open' && e.ports[0]) serve(e.ports[0], e.data.token, e.data.start, e.data.end)
  })
}

export async function registerStream(src: StreamSource) {
  const sw = navigator.serviceWorker.controller
  if (!sw) throw new Error('SW_UNAVAILABLE')
  ensureListener()
  const token = randomId(24)
  sources.set(token, src)
  await new Promise<void>((resolve, reject) => {
    const ch = new MessageChannel()
    const timer = setTimeout(() => reject(new Error('SW_TIMEOUT')), 4000)
    ch.port1.onmessage = () => {
      clearTimeout(timer)
      resolve()
    }
    sw.postMessage({ type: 'td-register', token, name: src.name, mime: src.mime, size: src.size, attachment: src.attachment }, [ch.port2])
  })
  const kind = src.attachment ? 'download' : 'stream'
  return { token, url: `/__td/${kind}/${token}/${encodeURIComponent(src.name)}` }
}

export function unregisterStream(token: string) {
  sources.delete(token)
  navigator.serviceWorker?.controller?.postMessage({ type: 'td-unregister', token })
}

export function triggerDownload(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => a.remove(), 1000)
}
