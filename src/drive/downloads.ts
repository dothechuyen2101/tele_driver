import { downloadZip as makeZip, predictLength } from 'client-zip'
import { randomId } from '@/lib/bytes'
import { registerStream, streamingAvailable, triggerDownload, unregisterStream } from '@/lib/streamBridge'
import { errorMessage, isAbortError } from '@/lib/utils'
import { useDrive } from '@/stores/app'
import { useTransfers } from '@/stores/transfers'
import { asReadableStream, readFileBlob, readFileRange } from './logical'
import { collectTree, type DriveFile, type DriveItem } from './model'

/** Without a service worker, files are assembled in memory; keep that bounded. */
const BLOB_FALLBACK_LIMIT = 512 * 1024 * 1024

function anySignal(a: AbortSignal, b: AbortSignal) {
  if ('any' in AbortSignal) return AbortSignal.any([a, b])
  const c = new AbortController()
  const on = () => c.abort()
  a.addEventListener('abort', on)
  b.addEventListener('abort', on)
  return c.signal
}

function startTransfer(name: string, size: number, encrypted: boolean) {
  const id = randomId()
  const abort = new AbortController()
  useTransfers.getState().add({ id, kind: 'download', name, size, encrypted, abort, status: 'running' })
  const t = {
    id,
    abort,
    bytes: (n: number) => useTransfers.getState().progress(id, n),
    done: () => useTransfers.getState().update(id, { status: 'done', done: size || undefined }),
    fail: (err: unknown) => {
      if (abort.signal.aborted || isAbortError(err)) useTransfers.getState().update(id, { status: 'canceled' })
      else useTransfers.getState().update(id, { status: 'error', error: errorMessage(err) })
    },
  }
  return t
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  triggerDownload(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadFile(file: DriveFile) {
  if (!file.complete) throw new Error('FILE_INCOMPLETE')
  const t = startTransfer(file.name, file.size, !!file.enc)
  try {
    if (streamingAvailable()) {
      const { url, token } = await registerStream({
        name: file.name,
        mime: file.mime,
        size: file.size,
        attachment: true,
        open: (start, end, signal) => readFileRange(file, start, end ?? file.size, anySignal(signal, t.abort.signal)),
        onBytes: t.bytes,
        onDone: () => {
          t.done()
          unregisterStream(token)
        },
        onError: (err) => {
          t.fail(err)
          unregisterStream(token)
        },
      })
      triggerDownload(url, file.name)
    } else {
      if (file.size > BLOB_FALLBACK_LIMIT) throw new Error('SW_REQUIRED')
      saveBlob(await readFileBlob(file, t.abort.signal, t.bytes), file.name)
      t.done()
    }
  } catch (err) {
    t.fail(err)
    throw err
  }
}

function uniquePath(path: string, used: Set<string>) {
  if (!used.has(path)) {
    used.add(path)
    return path
  }
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const base = path.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${dir}${stem} (${i})${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/** Streams several files/folders as one ZIP (store mode, ZIP64) straight to disk. */
export async function downloadAsZip(items: DriveItem[], zipName: string) {
  const { index } = useDrive.getState()
  const used = new Set<string>()
  const files: { file: DriveFile; path: string }[] = []
  const dirs: string[] = []
  for (const item of items) {
    if (item.type === 'file') {
      if (item.complete) files.push({ file: item, path: uniquePath(item.name, used) })
      continue
    }
    const root = uniquePath(item.name, used)
    dirs.push(`${root}/`)
    const tree = collectTree(index, item.id, `${root}/`)
    for (const f of tree.files) if (f.file.complete) files.push({ file: f.file, path: uniquePath(f.path, used) })
  }
  if (!files.length && !dirs.length) throw new Error('NOTHING_TO_DOWNLOAD')

  const metadata = [...dirs.map((name) => ({ name })), ...files.map((f) => ({ name: f.path, size: f.file.size }))]
  const length = Number(predictLength(metadata))
  const t = startTransfer(zipName, length, files.some((f) => !!f.file.enc))

  async function* entries() {
    for (const name of dirs) yield { name, lastModified: new Date() }
    for (const { file, path } of files) {
      yield {
        name: path,
        size: file.size,
        lastModified: new Date(file.date * 1000),
        input: asReadableStream(readFileRange(file, 0, file.size, t.abort.signal)),
      }
    }
  }

  try {
    const response = makeZip(entries(), { length })
    const body = response.body!
    if (streamingAvailable()) {
      const reader = body.getReader()
      const { url, token } = await registerStream({
        name: zipName,
        mime: 'application/zip',
        size: length,
        attachment: true,
        open: () => ({
          next: async () => {
            const r = await reader.read()
            return r.done ? { done: true, value: undefined } : { done: false, value: r.value }
          },
          return: async () => {
            await reader.cancel()
            return { done: true, value: undefined }
          },
        }),
        onBytes: t.bytes,
        onDone: () => {
          t.done()
          unregisterStream(token)
        },
        onError: (err) => {
          t.fail(err)
          unregisterStream(token)
        },
      })
      triggerDownload(url, zipName)
    } else {
      if (length > BLOB_FALLBACK_LIMIT) throw new Error('SW_REQUIRED')
      const blob = await new Response(body).blob()
      t.bytes(blob.size)
      saveBlob(blob, zipName)
      t.done()
    }
  } catch (err) {
    t.fail(err)
    throw err
  }
}
