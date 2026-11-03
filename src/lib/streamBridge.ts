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
  /** The consumer went away, e.g. the user cancelled the download in the browser. */
  onCancel?: () => void
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
      src.onCancel?.()
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

/** How long the browser gets to start pulling a download before we call it failed. */
const DOWNLOAD_START_TIMEOUT = 20_000

/**
 * Saves a stream to disk through the service worker.
 *
 * Chrome does not send `<a download>` requests through service workers (they
 * would hit the network and save index.html instead), so the download is
 * started by navigating a hidden iframe to a URL answered with
 * `Content-Disposition: attachment`. A watchdog reports a download that never
 * starts instead of leaving it at 0 B forever.
 */
export async function downloadViaServiceWorker(src: Omit<StreamSource, 'attachment'>) {
  let opened = false
  let settled = false
  let token = ''
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('aria-hidden', 'true')
  const settle = () => {
    if (settled) return false
    settled = true
    clearTimeout(watchdog)
    if (token) unregisterStream(token)
    // Give the browser a moment to finalize the file before dropping the frame.
    setTimeout(() => frame.remove(), 10_000)
    return true
  }
  const watchdog = setTimeout(() => {
    if (!opened && settle()) src.onError?.(new Error('DOWNLOAD_NOT_STARTED'))
  }, DOWNLOAD_START_TIMEOUT)
  try {
    const reg = await registerStream({
      ...src,
      attachment: true,
      open: (start, end, signal) => {
        opened = true
        return src.open(start, end, signal)
      },
      onDone: () => settle() && src.onDone?.(),
      onError: (err) => settle() && src.onError?.(err),
      onCancel: () => settle() && src.onCancel?.(),
    })
    token = reg.token
    frame.src = reg.url
    document.body.appendChild(frame)
  } catch (err) {
    settle()
    throw err
  }
}

/** Saves a blob: or data: URL (never a service-worker URL, see downloadViaServiceWorker). */
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
