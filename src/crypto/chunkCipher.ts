/**
 * Chunked AES-256-GCM. Each plaintext chunk of 1 MiB − 16 B becomes exactly
 * 1 MiB of ciphertext, which lines up with Telegram's 1 MiB download blocks, so
 * any byte range can be fetched and decrypted on its own (video seeking).
 *
 *   iv  = fileNonce (8 B) ‖ chunkIndex (u32 BE)
 *   aad = chunkIndex (u32 BE) ‖ isLast (u8)        — blocks reordering and truncation
 */
import { fromBase64Url, fromUtf8, toArrayBuffer, toBase64Url, utf8 } from '@/lib/bytes'
import type { ByteSource } from '@/lib/byteSource'

export const CIPHER_CHUNK = 1024 * 1024
export const TAG_BYTES = 16
export const PLAIN_CHUNK = CIPHER_CHUNK - TAG_BYTES
/** Chunk index reserved for the encrypted file name/mime. */
const META_INDEX = 0xffffffff

export function chunkCount(plainSize: number) {
  return Math.max(1, Math.ceil(plainSize / PLAIN_CHUNK))
}

export function cipherSize(plainSize: number) {
  return plainSize + chunkCount(plainSize) * TAG_BYTES
}

export function plainChunkLength(index: number, plainSize: number) {
  const n = chunkCount(plainSize)
  return index < n - 1 ? PLAIN_CHUNK : plainSize - (n - 1) * PLAIN_CHUNK
}

/** Ciphertext byte span of one chunk inside the encrypted stream. */
export function cipherChunkSpan(index: number, plainSize: number) {
  return { offset: index * CIPHER_CHUNK, length: plainChunkLength(index, plainSize) + TAG_BYTES }
}

function ivFor(nonce: Uint8Array, index: number) {
  const iv = new Uint8Array(12)
  iv.set(nonce.subarray(0, 8), 0)
  new DataView(iv.buffer).setUint32(8, index)
  return iv
}

function aadFor(index: number, last: boolean) {
  const aad = new Uint8Array(5)
  new DataView(aad.buffer).setUint32(0, index)
  aad[4] = last ? 1 : 0
  return aad
}

export async function encryptChunk(key: CryptoKey, nonce: Uint8Array, index: number, last: boolean, plain: Uint8Array) {
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivFor(nonce, index), additionalData: aadFor(index, last) },
    key,
    toArrayBuffer(plain),
  )
  return new Uint8Array(ct)
}

export async function decryptChunk(key: CryptoKey, nonce: Uint8Array, index: number, last: boolean, cipher: Uint8Array) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivFor(nonce, index), additionalData: aadFor(index, last) },
    key,
    toArrayBuffer(cipher),
  )
  return new Uint8Array(pt)
}

export interface EncryptedMeta {
  name: string
  mime: string
}

export async function encryptMeta(key: CryptoKey, nonce: Uint8Array, meta: EncryptedMeta) {
  const ct = await encryptChunk(key, nonce, META_INDEX, true, utf8(JSON.stringify({ n: meta.name, m: meta.mime })))
  return toBase64Url(ct)
}

export async function decryptMeta(key: CryptoKey, nonce: Uint8Array, encoded: string): Promise<EncryptedMeta> {
  const pt = await decryptChunk(key, nonce, META_INDEX, true, fromBase64Url(encoded))
  const obj = JSON.parse(fromUtf8(pt)) as { n?: string; m?: string }
  return { name: obj.n || 'file', mime: obj.m || 'application/octet-stream' }
}

/**
 * Produces the encrypted byte stream of a plaintext source lazily, for any
 * (offset, length) window, caching a few recent chunks because uploads read
 * 512 KiB halves of each 1 MiB chunk.
 */
export class SourceEncryptor implements ByteSource {
  private cache = new Map<number, Promise<Uint8Array>>()
  readonly plainSize: number
  readonly size: number
  private readonly source: ByteSource
  private readonly key: CryptoKey
  private readonly nonce: Uint8Array

  constructor(source: ByteSource, key: CryptoKey, nonce: Uint8Array) {
    this.source = source
    this.key = key
    this.nonce = nonce
    this.plainSize = source.size
    this.size = cipherSize(source.size)
  }

  private chunk(index: number) {
    let p = this.cache.get(index)
    if (!p) {
      const start = index * PLAIN_CHUNK
      const len = plainChunkLength(index, this.plainSize)
      const last = index === chunkCount(this.plainSize) - 1
      p = this.source.read(start, len).then((plain) => encryptChunk(this.key, this.nonce, index, last, plain))
      this.cache.set(index, p)
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.size)
    const out = new Uint8Array(end - offset)
    let pos = offset
    while (pos < end) {
      const index = Math.floor(pos / CIPHER_CHUNK)
      const chunk = await this.chunk(index)
      const within = pos - index * CIPHER_CHUNK
      const take = Math.min(chunk.length - within, end - pos)
      out.set(chunk.subarray(within, within + take), pos - offset)
      pos += take
    }
    return out
  }
}
