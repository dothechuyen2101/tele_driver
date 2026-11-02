/** Google Drive REST (v3) straight from the browser: listing, exports and ranged downloads. */
import { blobSource, blockSource } from '@/lib/byteSource'
import { sleep } from '@/lib/utils'
import type { ImportSource } from '@/drive/uploads'
import { GoogleAuthError } from './auth'

const API = 'https://www.googleapis.com/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** If Drive ever ignores Range, files up to this size are fetched whole instead. */
const NO_RANGE_LIMIT = 512 * 1024 * 1024

/** Google Docs formats and what they are exported to. */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png' },
}

export interface DriveEntry {
  fileId: string
  name: string
  mime: string
  /** -1 for Google Docs, whose export size is only known after exporting. */
  size: number
  /** Folder path inside the import, '/'-separated, '' at the top. */
  dir: string
  exportMime?: string
  /** Set when the item cannot be imported (shortcut, form, empty…). */
  skip?: string
}

interface ApiFile {
  id: string
  name: string
  mimeType: string
  size?: string
}

/** Turns a Drive file into an import entry (export target or skip reason included). */
export function toEntry(f: ApiFile, dir: string): DriveEntry {
  const base = { fileId: f.id, dir }
  if (f.mimeType.startsWith('application/vnd.google-apps.')) {
    const exp = EXPORTS[f.mimeType]
    if (!exp) return { ...base, name: f.name, mime: f.mimeType, size: -1, skip: f.mimeType.endsWith('.shortcut') ? 'shortcut' : 'unsupported' }
    const name = f.name.toLowerCase().endsWith(exp.ext) ? f.name : f.name + exp.ext
    return { ...base, name, mime: exp.mime, size: -1, exportMime: exp.mime }
  }
  const size = Number(f.size ?? 0)
  return { ...base, name: f.name, mime: f.mimeType || 'application/octet-stream', size, skip: size > 0 ? undefined : 'empty' }
}

async function request(url: string, token: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    if (res.status === 401) throw new GoogleAuthError()
    // Rate limits and transient server errors: exponential backoff.
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 4) {
      const body = res.status === 403 ? await res.clone().text() : ''
      if (res.status !== 403 || /rateLimit|userRateLimitExceeded/i.test(body)) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
    }
    if (!res.ok && res.status !== 206) throw new Error(`GOOGLE_HTTP_${res.status}`)
    return res
  }
}

/** Name, type and size of one file (the Picker does not always report sizes). */
export async function getMeta(fileId: string, token: string) {
  const res = await request(`${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`, token)
  return (await res.json()) as ApiFile
}

/** Walks a folder tree (shared drives included) and returns every file with its relative path. */
export async function listTree(rootId: string, token: string, opts: { signal?: AbortSignal; onProgress?: (n: number) => void } = {}): Promise<DriveEntry[]> {
  const out: DriveEntry[] = []
  const queue: { id: string; dir: string }[] = [{ id: rootId, dir: '' }]
  while (queue.length) {
    const { id, dir } = queue.shift()!
    let pageToken = ''
    do {
      const q = encodeURIComponent(`'${id.replace(/'/g, "\\'")}' in parents and trashed = false`)
      const url = `${API}/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,size)&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`
      const res = await request(url, token, {}, opts.signal)
      const body = (await res.json()) as { nextPageToken?: string; files: ApiFile[] }
      for (const f of body.files) {
        if (f.mimeType === FOLDER_MIME) queue.push({ id: f.id, dir: dir ? `${dir}/${f.name}` : f.name })
        else out.push(toEntry(f, dir))
      }
      opts.onProgress?.(out.length)
      pageToken = body.nextPageToken ?? ''
    } while (pageToken)
  }
  return out
}

/**
 * Bytes of a Drive file for the uploader. Regular files are read with HTTP
 * Range in 8 MiB blocks (never fully in memory); Google Docs are exported first.
 */
export async function driveSource(entry: DriveEntry, getToken: () => string, signal?: AbortSignal): Promise<ImportSource> {
  const srcTag = `gd:${entry.fileId}`
  const id = encodeURIComponent(entry.fileId)
  if (entry.exportMime) {
    const res = await request(`${API}/files/${id}/export?mimeType=${encodeURIComponent(entry.exportMime)}`, getToken(), {}, signal)
    const blob = await res.blob()
    return { ...blobSource(blob), name: entry.name, mime: entry.exportMime, srcTag }
  }
  const url = `${API}/files/${id}?alt=media&supportsAllDrives=true`
  let whole: Promise<Uint8Array> | null = null
  const fetchBlock = async (start: number, end: number) => {
    if (whole) return (await whole).subarray(start, end)
    const res = await request(url, getToken(), { headers: { Range: `bytes=${start}-${end - 1}` } }, signal)
    if (res.status === 206) return new Uint8Array(await res.arrayBuffer())
    // Range ignored: the body is the whole file.
    if (entry.size > NO_RANGE_LIMIT) {
      await res.body?.cancel()
      throw new Error('RANGE_UNSUPPORTED')
    }
    whole = res.arrayBuffer().then((b) => new Uint8Array(b))
    return (await whole).subarray(start, end)
  }
  return { ...blockSource(entry.size, fetchBlock), name: entry.name, mime: entry.mime, srcTag }
}
