import { CIPHER_CHUNK, PLAIN_CHUNK, chunkCount, cipherChunkSpan, decryptChunk } from '@/crypto/chunkCipher'
import { unwrapFileKey } from '@/crypto/vault'
import { fromBase64Url } from '@/lib/bytes'
import { requireStorage, useDrive } from '@/stores/app'
import { readMessageRange } from '@/telegram/download'
import type { DriveFile } from './model'
import { mapRange } from './split'

/**
 * Streams plaintext bytes [start, end) of a logical file: maps the range onto
 * its Telegram parts and, for encrypted files, decrypts whole chunks and trims.
 */
export async function* readFileRange(file: DriveFile, start: number, end: number, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (!file.complete) throw new Error('FILE_INCOMPLETE')
  end = Math.min(end, file.size)
  if (start >= end) return
  const { ref } = requireStorage()
  const partSizes = file.parts.map((p) => p.size)

  if (!file.enc) {
    for (const slice of mapRange(partSizes, start, end)) {
      yield* readMessageRange(ref, file.parts[slice.part].msgId, slice.offset, slice.length, signal)
    }
    return
  }

  const vaultKey = useDrive.getState().vaultKey
  if (!vaultKey) throw new Error('VAULT_LOCKED')
  const dek = await unwrapFileKey(vaultKey, file.enc.wrappedKey)
  const nonce = fromBase64Url(file.enc.nonce)
  const plainSize = file.size
  const total = chunkCount(plainSize)
  const first = Math.floor(start / PLAIN_CHUNK)
  const last = Math.floor((end - 1) / PLAIN_CHUNK)
  const lastSpan = cipherChunkSpan(last, plainSize)

  let index = first
  let buf = new Uint8Array(cipherChunkSpan(index, plainSize).length)
  let filled = 0
  for (const slice of mapRange(partSizes, first * CIPHER_CHUNK, lastSpan.offset + lastSpan.length)) {
    for await (const chunk of readMessageRange(ref, file.parts[slice.part].msgId, slice.offset, slice.length, signal)) {
      let off = 0
      while (off < chunk.length) {
        const take = Math.min(buf.length - filled, chunk.length - off)
        buf.set(chunk.subarray(off, off + take), filled)
        filled += take
        off += take
        if (filled < buf.length) continue
        const plain = await decryptChunk(dek, nonce, index, index === total - 1, buf)
        const base = index * PLAIN_CHUNK
        yield plain.subarray(Math.max(start, base) - base, Math.min(end, base + plain.length) - base)
        if (++index > last) return
        buf = new Uint8Array(cipherChunkSpan(index, plainSize).length)
        filled = 0
      }
    }
  }
  if (index <= last) throw new Error('FILE_TRUNCATED')
}

/** Reads a whole (small) file into a Blob, for previews and the no-service-worker fallback. */
export async function readFileBlob(file: DriveFile, signal?: AbortSignal, onBytes?: (n: number) => void) {
  const parts: BlobPart[] = []
  for await (const chunk of readFileRange(file, 0, file.size, signal)) {
    parts.push(chunk.slice())
    onBytes?.(chunk.length)
  }
  return new Blob(parts, { type: file.mime })
}

export function asReadableStream(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await gen.next()
        if (r.done) controller.close()
        else controller.enqueue(r.value)
      } catch (err) {
        controller.error(err)
      }
    },
    async cancel() {
      await gen.return(undefined)
    },
  })
}
