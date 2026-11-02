import { Api } from 'teleproto'
import { db } from '@/db/db'
import { SourceEncryptor, encryptMeta } from '@/crypto/chunkCipher'
import { newFileKey, wrapFileKey } from '@/crypto/vault'
import { blobSource, subSource, type ByteSource } from '@/lib/byteSource'
import { randomId, toBase64Url } from '@/lib/bytes'
import { guessMime } from '@/lib/mime'
import { probeMedia, thumbKey, type MediaProbe } from '@/lib/thumbs'
import { errorMessage, isAbortError } from '@/lib/utils'
import { requireStorage, useDrive } from '@/stores/app'
import { useSettings } from '@/stores/settings'
import { useTransfers } from '@/stores/transfers'
import { rememberMessage } from '@/telegram/download'
import { deleteMessages, toEntry } from '@/telegram/messages'
import { chatKeyOf } from '@/telegram/peers'
import { maxUploadParts, sendDocument, uploadSmall, uploadSource } from '@/telegram/upload'
import { composeText, folderRef, type TagFields } from './metadata'
import { isFolderEncrypted } from './model'
import { ensureFolder } from './ops'
import { maxDocumentBytes, splitPartName, splitPlan } from './split'

/** Bytes to store in the drive, from a local file or a remote origin (Google Drive, another chat). */
export interface ImportSource extends ByteSource {
  name: string
  mime: string
  /** Local file, used for thumbnails and media metadata. */
  file?: File
  /** Origin of an imported file (`s=` tag), used to skip duplicates. */
  srcTag?: string
}

export function fileSource(file: File): ImportSource {
  const name = file.name || 'file'
  return { ...blobSource(file), name, mime: guessMime(name, file.type), file }
}

export interface UploadRequest {
  file: File
  folderId: number
  /** Path inside an uploaded folder, e.g. `Photos/2024/a.jpg`. */
  relPath?: string
}

interface Job {
  id: string
  source: ImportSource
  folderId: number
  encrypt: boolean
  abort: AbortController
}

const queue: Job[] = []
let active = 0

/** Whether uploading into this folder will encrypt (and therefore needs an unlocked vault). */
export function needsEncryption(folderId: number) {
  return useSettings.getState().encryptAll || isFolderEncrypted(useDrive.getState().index, folderId)
}

/** Finds or creates `dirs` below `baseId`; `cache` keeps ids across calls of one batch. */
export async function resolveFolderPath(baseId: number, dirs: string[], cache: Map<string, number>) {
  let folderId = baseId
  let path = `${baseId}`
  for (const dir of dirs) {
    path += `/${dir}`
    let id = cache.get(path)
    if (id === undefined) {
      id = await ensureFolder(folderId, dir)
      cache.set(path, id)
    }
    folderId = id
  }
  return folderId
}

/** Creates the folders of a folder upload, then queues every file. */
export async function enqueueUploads(requests: UploadRequest[]) {
  const folderIds = new Map<string, number>()
  const resolved: { file: File; folderId: number }[] = []
  for (const r of requests) {
    const dirs = r.relPath?.split('/').slice(0, -1).filter(Boolean) ?? []
    resolved.push({ file: r.file, folderId: await resolveFolderPath(r.folderId, dirs, folderIds) })
  }
  for (const { file, folderId } of resolved) addJob(fileSource(file), folderId)
}

function addJob(source: ImportSource, folderId: number) {
  const job: Job = { id: randomId(), source, folderId, encrypt: needsEncryption(folderId), abort: new AbortController() }
  useTransfers.getState().add({
    id: job.id,
    kind: 'upload',
    name: source.name,
    size: source.size,
    encrypted: job.encrypt,
    abort: job.abort,
  })
  queue.push(job)
  pump()
}

function pump() {
  const limit = Math.max(1, useSettings.getState().uploadConcurrency)
  while (active < limit && queue.length) {
    const job = queue.shift()!
    if (job.abort.signal.aborted) continue
    active++
    void run(job).finally(() => {
      active--
      pump()
    })
  }
}

async function run(job: Job) {
  const t = useTransfers.getState()
  t.update(job.id, { status: 'running' })
  try {
    await uploadImportSource(job.source, job.folderId, {
      encrypt: job.encrypt,
      signal: job.abort.signal,
      onBytes: (n) => useTransfers.getState().progress(job.id, n),
      onSize: (size) => useTransfers.getState().update(job.id, { size }),
    })
    useTransfers.getState().update(job.id, { status: 'done' })
  } catch (err) {
    if (job.abort.signal.aborted || isAbortError(err)) {
      useTransfers.getState().update(job.id, { status: 'canceled' })
      return
    }
    useTransfers.getState().update(job.id, {
      status: 'error',
      error: errorMessage(err),
      retry: () => {
        useTransfers.getState().update(job.id, { status: 'canceled', retry: undefined })
        addJob(job.source, job.folderId)
      },
    })
  }
}

export interface UploadOptions {
  encrypt: boolean
  signal: AbortSignal
  onBytes: (n: number) => void
  /** Bytes that will actually be sent (larger than the file when encrypted). */
  onSize?: (size: number) => void
}

/** Uploads one source into a folder (encrypting and splitting as needed); returns the drive file key. */
export async function uploadImportSource(src: ImportSource, folderId: number, { encrypt, signal, onBytes, onSize }: UploadOptions) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const { name, mime } = src
  const partMax = maxDocumentBytes(await maxUploadParts())
  const probe: MediaProbe = src.file ? await probeMedia(src.file, mime) : { kind: 'other' }

  let stream: ByteSource
  let encFields: TagFields = {}
  if (encrypt) {
    const vaultKey = useDrive.getState().vaultKey
    if (!vaultKey) throw new Error('VAULT_LOCKED')
    const { dek, nonce } = await newFileKey()
    stream = new SourceEncryptor(src, dek, nonce)
    const en = await encryptMeta(dek, nonce, { name, mime })
    encFields = { e: await wrapFileKey(vaultKey, dek), x: toBase64Url(nonce), en, sz: String(src.size) }
    useDrive.setState((s) => ({ decrypted: new Map(s.decrypted).set(en, { name, mime }) }))
  } else {
    if (src.size === 0) throw new Error('EMPTY_FILE')
    stream = src
  }
  onSize?.(stream.size)

  const spans = splitPlan(stream.size, partMax)
  const count = spans.length
  const group = count > 1 ? randomId(10) : undefined
  const thumb = !encrypt && count === 1 && probe.thumb ? await uploadSmall(probe.thumb, 'thumb.jpg') : undefined

  const sent: number[] = []
  try {
    for (let k = 0; k < count; k++) {
      signal.throwIfAborted()
      const span = spans[k]
      const partName = encrypt ? `${randomId(12)}.bin` : count > 1 ? splitPartName(name, k + 1, count) : name
      const fields: TagFields = { f: folderRef(folderId), ...encFields }
      if (src.srcTag) fields.s = src.srcTag
      if (group) {
        fields.g = group
        fields.i = `${k + 1}/${count}`
        if (!encrypt) {
          fields.n = name
          fields.ts = String(src.size)
        }
      }
      const input = await uploadSource(subSource(stream, span.offset, span.size), partName, { signal, onBytes })
      const attributes: Api.TypeDocumentAttribute[] = [new Api.DocumentAttributeFilename({ fileName: partName })]
      let forceFile = true
      if (!encrypt && count === 1) {
        if (probe.kind === 'video' && probe.duration && probe.w) {
          attributes.push(new Api.DocumentAttributeVideo({ duration: probe.duration, w: probe.w, h: probe.h ?? 0, supportsStreaming: true }))
          forceFile = false
        } else if (probe.kind === 'audio' && probe.duration) {
          attributes.push(new Api.DocumentAttributeAudio({ duration: Math.round(probe.duration) }))
          forceFile = false
        } else if (probe.kind === 'image' && probe.w && probe.h) {
          attributes.push(new Api.DocumentAttributeImageSize({ w: probe.w, h: probe.h }))
        }
      }
      signal.throwIfAborted()
      const msg = await sendDocument(ref, input, {
        mime: encrypt || count > 1 ? 'application/octet-stream' : mime,
        attributes,
        thumb: k === 0 ? thumb : undefined,
        caption: composeText('', 'file', fields),
        forceFile,
      })
      sent.push(msg.id)
      rememberMessage(ref, msg)
      const entry = toEntry(chatKey, msg)
      if (entry) await db.entries.put(entry)
    }
    const fileKey = group ? `g:${group}` : `m:${sent[0]}`
    if (probe.thumb) await db.thumbs.put({ id: thumbKey(chatKey, fileKey), blob: probe.thumb, at: Date.now() })
    return fileKey
  } catch (err) {
    // Do not leave half of a split file behind.
    if (sent.length) {
      await deleteMessages(ref, sent).catch(() => {})
      await db.entries.bulkDelete(sent.map((id) => `${chatKey}:${id}`))
    }
    throw err
  }
}

export function hasActiveUploads() {
  return useTransfers.getState().items.some((t) => t.kind !== 'download' && (t.status === 'queued' || t.status === 'running'))
}
