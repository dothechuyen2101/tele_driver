import { Api } from 'teleproto'
import { db } from '@/db/db'
import { BlobEncryptor, encryptMeta } from '@/crypto/chunkCipher'
import { newFileKey, wrapFileKey } from '@/crypto/vault'
import { randomId, toBase64Url } from '@/lib/bytes'
import { guessMime } from '@/lib/mime'
import { probeMedia, thumbKey } from '@/lib/thumbs'
import { errorMessage, isAbortError } from '@/lib/utils'
import { requireStorage, useDrive } from '@/stores/app'
import { useSettings } from '@/stores/settings'
import { useTransfers } from '@/stores/transfers'
import { rememberMessage } from '@/telegram/download'
import { deleteMessages, toEntry } from '@/telegram/messages'
import { chatKeyOf } from '@/telegram/peers'
import { blobSource, maxUploadParts, sendDocument, subSource, uploadSmall, uploadSource, type ByteSource } from '@/telegram/upload'
import { composeText, folderRef, type TagFields } from './metadata'
import { isFolderEncrypted } from './model'
import { ensureFolder } from './ops'
import { maxDocumentBytes, splitPartName, splitPlan } from './split'

export interface UploadRequest {
  file: File
  folderId: number
  /** Path inside an uploaded folder, e.g. `Photos/2024/a.jpg`. */
  relPath?: string
}

interface Job {
  id: string
  file: File
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

/** Creates the folders of a folder upload, then queues every file. */
export async function enqueueUploads(requests: UploadRequest[]) {
  const folderIds = new Map<string, number>()
  const resolved: { file: File; folderId: number }[] = []
  for (const r of requests) {
    let folderId = r.folderId
    const dirs = r.relPath?.split('/').slice(0, -1).filter(Boolean) ?? []
    let path = `${r.folderId}`
    for (const dir of dirs) {
      path += `/${dir}`
      let id = folderIds.get(path)
      if (id === undefined) {
        id = await ensureFolder(folderId, dir)
        folderIds.set(path, id)
      }
      folderId = id
    }
    resolved.push({ file: r.file, folderId })
  }
  for (const { file, folderId } of resolved) addJob(file, folderId)
}

function addJob(file: File, folderId: number) {
  const job: Job = { id: randomId(), file, folderId, encrypt: needsEncryption(folderId), abort: new AbortController() }
  useTransfers.getState().add({
    id: job.id,
    kind: 'upload',
    name: file.name,
    size: file.size,
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
    await uploadOne(job, (n) => useTransfers.getState().progress(job.id, n))
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
        addJob(job.file, job.folderId)
      },
    })
  }
}

async function uploadOne(job: Job, onBytes: (n: number) => void) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const { file, folderId, encrypt } = job
  const signal = job.abort.signal
  const name = file.name || 'file'
  const mime = guessMime(name, file.type)
  const partMax = maxDocumentBytes(await maxUploadParts())
  const probe = await probeMedia(file, mime)

  let source: ByteSource
  let encFields: TagFields = {}
  if (encrypt) {
    const vaultKey = useDrive.getState().vaultKey
    if (!vaultKey) throw new Error('VAULT_LOCKED')
    const { dek, nonce } = await newFileKey()
    source = new BlobEncryptor(file, dek, nonce)
    const en = await encryptMeta(dek, nonce, { name, mime })
    encFields = { e: await wrapFileKey(vaultKey, dek), x: toBase64Url(nonce), en, sz: String(file.size) }
    useDrive.setState((s) => ({ decrypted: new Map(s.decrypted).set(en, { name, mime }) }))
  } else {
    if (file.size === 0) throw new Error('EMPTY_FILE')
    source = blobSource(file)
  }
  useTransfers.getState().update(job.id, { size: source.size })

  const spans = splitPlan(source.size, partMax)
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
      if (group) {
        fields.g = group
        fields.i = `${k + 1}/${count}`
        if (!encrypt) {
          fields.n = name
          fields.ts = String(file.size)
        }
      }
      const input = await uploadSource(subSource(source, span.offset, span.size), partName, { signal, onBytes })
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
    if (probe.thumb) {
      const fileKey = group ? `g:${group}` : `m:${sent[0]}`
      await db.thumbs.put({ id: thumbKey(chatKey, fileKey), blob: probe.thumb, at: Date.now() })
    }
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
  return useTransfers.getState().items.some((t) => t.kind === 'upload' && (t.status === 'queued' || t.status === 'running'))
}
