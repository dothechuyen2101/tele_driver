import { Api } from 'teleproto'
import { generateRandomLong } from 'teleproto/Helpers'
import { FileUploader } from 'teleproto/client/files/FileUploader'
import { rememberUpload } from 'teleproto/client/files/uploadRegistry'
import { choosePartSize, MAX_PART_SIZE } from 'teleproto/client/files/PartsManager'
import { Buffer } from 'teleproto/platform/index'
import { getClient } from './client'
import { extractMessages, fetchMessages } from './messages'
import { inputPeer, type StorageRef } from './peers'

/** Something that can hand out bytes by offset, e.g. a Blob or an encrypting view of one. */
export interface ByteSource {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export function blobSource(blob: Blob, start = 0, size = blob.size - start): ByteSource {
  return {
    size,
    read: async (offset, length) => new Uint8Array(await blob.slice(start + offset, start + Math.min(offset + length, size)).arrayBuffer()),
  }
}

export function subSource(source: ByteSource, start: number, size: number): ByteSource {
  return { size, read: (offset, length) => source.read(start + offset, Math.min(length, size - offset)) }
}

/** Telegram's per-file part limit: 4000 parts (2000 MiB), 8000 with Premium. */
export function maxUploadParts() {
  return getClient()._files.maxUploadParts()
}

/**
 * Uploads a byte source part by part (never holding the whole file in memory)
 * over teleproto's parallel upload connections.
 */
export async function uploadSource(
  source: ByteSource,
  name: string,
  opts: { signal?: AbortSignal; onBytes?: (n: number) => void } = {},
): Promise<Api.InputFile | Api.InputFileBig> {
  if (source.size <= 0) throw new Error('EMPTY_FILE')
  const client = getClient()
  const files = client._files
  const fileId = generateRandomLong(true)
  let partSize = choosePartSize(source.size, files.maxPartSize)
  const maxParts = await files.maxUploadParts()
  if (Math.ceil(source.size / partSize) > maxParts) partSize = MAX_PART_SIZE
  if (Math.ceil(source.size / partSize) > maxParts) throw new Error('FILE_TOO_LARGE')

  const read = async (offset: number, length: number) => {
    const bytes = await source.read(offset, length)
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  const dcId = client.session.dcId
  let done = 0
  const uploader: FileUploader = new FileUploader(files, {
    fileId,
    size: source.size,
    partSize,
    dcId,
    read,
    signal: opts.signal,
    onPart: () => {
      const next = Math.min(source.size, done + partSize)
      opts.onBytes?.(next - done)
      done = next
    },
  })
  await uploader.run()
  const parts = uploader.partCount
  const input = uploader.isBig
    ? new Api.InputFileBig({ id: fileId, parts, name })
    : new Api.InputFile({ id: fileId, parts, name, md5Checksum: '' })
  rememberUpload(input, {
    fileId,
    size: source.size,
    partSize,
    partCount: parts,
    isBig: uploader.isBig,
    dcId,
    open: async () => ({ read, close: async () => {} }),
  })
  return input
}

export interface SendDocumentOptions {
  mime: string
  attributes: Api.TypeDocumentAttribute[]
  thumb?: Api.TypeInputFile
  caption: string
  forceFile: boolean
}

export async function sendDocument(ref: StorageRef, file: Api.TypeInputFile, o: SendDocumentOptions): Promise<Api.Message> {
  const result = await getClient().invoke(
    new Api.messages.SendMedia({
      peer: inputPeer(ref),
      media: new Api.InputMediaUploadedDocument({
        file,
        mimeType: o.mime,
        attributes: o.attributes,
        thumb: o.thumb,
        forceFile: o.forceFile,
      }),
      message: o.caption,
      randomId: generateRandomLong(),
    }),
  )
  const msg = extractMessages(result)[0]
  if (msg) return msg
  const id =
    result instanceof Api.UpdateShortSentMessage
      ? result.id
      : result instanceof Api.Updates
        ? result.updates.find((u): u is Api.UpdateMessageID => u instanceof Api.UpdateMessageID)?.id
        : undefined
  if (id) {
    const fetched = (await fetchMessages(ref, [id])).get(id)
    if (fetched) return fetched
  }
  throw new Error('Telegram did not return the uploaded message')
}

/** Uploads a small in-memory blob (thumbnails). */
export async function uploadSmall(blob: Blob, name: string) {
  return uploadSource(blobSource(blob), name)
}
