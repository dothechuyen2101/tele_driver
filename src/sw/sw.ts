/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

interface Registration {
  clientId: string
  name: string
  mime: string
  size?: number
  attachment: boolean
}

/** Streams registered by pages: token → owner page and file metadata. */
const registry = new Map<string, Registration>()

self.addEventListener('message', (event) => {
  const d = event.data
  if (d?.type === 'td-register' && event.source && 'id' in event.source) {
    registry.set(d.token, { clientId: event.source.id, name: d.name, mime: d.mime, size: d.size, attachment: !!d.attachment })
    event.ports[0]?.postMessage('ok')
  } else if (d?.type === 'td-unregister') {
    registry.delete(d.token)
  }
  // `td-ping` only exists to keep the worker alive during long downloads.
})

// Registered before Workbox so these paths are always answered here.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/__td/')) return
  const [, , kind, token] = url.pathname.split('/')
  if (kind === 'share' && event.request.method === 'POST') event.respondWith(handleShare(event.request))
  else if ((kind === 'stream' || kind === 'download') && token) event.respondWith(handleStream(event.request, token, kind === 'download'))
})

/** Only audio/video may render inline; everything else is forced to a download, never a same-origin document. */
function isInlineSafe(mime: string) {
  return mime.startsWith('video/') || mime.startsWith('audio/')
}

async function handleStream(request: Request, token: string, attachment: boolean): Promise<Response> {
  const reg = registry.get(token)
  if (!reg) return new Response('Gone', { status: 410 })
  const client = await self.clients.get(reg.clientId)
  if (!client) {
    registry.delete(token)
    return new Response('Gone', { status: 410 })
  }
  const inline = !attachment && !reg.attachment && isInlineSafe(reg.mime)
  const size = reg.size
  let start = 0
  let end = size
  let status = 200
  const range = request.headers.get('range')
  if (range && size !== undefined) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        start = Math.max(0, size - Number(m[2]))
      } else {
        start = Number(m[1])
        end = m[2] ? Math.min(size, Number(m[2]) + 1) : size
      }
      if (start >= size || start >= end!) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      status = 206
    }
  }

  const channel = new MessageChannel()
  const port = channel.port1
  client.postMessage({ type: 'td-open', token, start, end }, [channel.port2])
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        return new Promise<void>((resolve) => {
          port.onmessage = (m: MessageEvent) => {
            const d = m.data
            if (d?.type === 'chunk') controller.enqueue(new Uint8Array(d.data))
            else if (d?.type === 'end') {
              controller.close()
              port.close()
            } else {
              controller.error(new Error(d?.message || 'stream error'))
              port.close()
            }
            resolve()
          }
          port.postMessage({ type: 'pull' })
        })
      },
      cancel() {
        port.postMessage({ type: 'cancel' })
        port.close()
      },
    },
    new CountQueuingStrategy({ highWaterMark: 3 }),
  )

  const headers = new Headers({
    'Content-Type': inline ? reg.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(reg.name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  })
  if (end !== undefined) headers.set('Content-Length', String(end - start))
  if (status === 206) headers.set('Content-Range', `bytes ${start}-${end! - 1}/${size}`)
  return new Response(body, { status, headers })
}

/** Android "Share to TeleDriver": park the files in Cache Storage and open the app. */
async function handleShare(request: Request): Promise<Response> {
  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  const cache = await caches.open('td-share')
  for (const key of await cache.keys()) await cache.delete(key)
  await Promise.all(
    files.map((f, i) =>
      cache.put(
        `/__td/shared/${i}`,
        new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name) } }),
      ),
    ),
  )
  return Response.redirect(`/?share=${files.length}`, 303)
}

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__td\//] }))
} catch {
  // index.html is not precached in dev mode.
}
