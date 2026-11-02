import { describe, expect, it } from 'vitest'
import {
  BlobEncryptor,
  CIPHER_CHUNK,
  PLAIN_CHUNK,
  chunkCount,
  cipherChunkSpan,
  cipherSize,
  decryptChunk,
  decryptMeta,
  encryptMeta,
} from './chunkCipher'
import { createVault, newFileKey, rewrapVault, unlockVault, unwrapFileKey, wrapFileKey, WrongPasswordError } from './vault'

function sample(size: number) {
  const b = new Uint8Array(size)
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) & 0xff
  return b
}

describe('chunk cipher', () => {
  it('computes sizes', () => {
    expect(chunkCount(0)).toBe(1)
    expect(cipherSize(0)).toBe(16)
    expect(cipherSize(PLAIN_CHUNK)).toBe(CIPHER_CHUNK)
    expect(cipherSize(PLAIN_CHUNK + 1)).toBe(CIPHER_CHUNK + 17)
    expect(cipherChunkSpan(1, PLAIN_CHUNK + 1)).toEqual({ offset: CIPHER_CHUNK, length: 17 })
  })

  it('encrypts a blob stream and decrypts each chunk independently', async () => {
    const { dek, nonce } = await newFileKey()
    const plain = sample(PLAIN_CHUNK * 2 + 1234)
    const enc = new BlobEncryptor(new Blob([plain]), dek, nonce)
    expect(enc.size).toBe(cipherSize(plain.length))

    // Read in odd windows like the uploader does, then reassemble.
    const parts: Uint8Array[] = []
    for (let off = 0; off < enc.size; off += 524288) parts.push(await enc.read(off, 524288))
    const stream = new Uint8Array(enc.size)
    let pos = 0
    for (const p of parts) {
      stream.set(p, pos)
      pos += p.length
    }
    expect(pos).toBe(enc.size)

    const n = chunkCount(plain.length)
    const out = new Uint8Array(plain.length)
    let written = 0
    for (let i = 0; i < n; i++) {
      const span = cipherChunkSpan(i, plain.length)
      const pt = await decryptChunk(dek, nonce, i, i === n - 1, stream.subarray(span.offset, span.offset + span.length))
      out.set(pt, written)
      written += pt.length
    }
    expect(written).toBe(plain.length)
    expect(out).toEqual(plain)
  })

  it('rejects reordered or truncated chunks', async () => {
    const { dek, nonce } = await newFileKey()
    const plain = sample(PLAIN_CHUNK + 10)
    const enc = new BlobEncryptor(new Blob([plain]), dek, nonce)
    const first = await enc.read(0, CIPHER_CHUNK)
    // Chunk 0 presented as the last chunk (truncation attack) must fail.
    await expect(decryptChunk(dek, nonce, 0, true, first)).rejects.toBeTruthy()
    // Chunk 0 presented as chunk 1 must fail.
    await expect(decryptChunk(dek, nonce, 1, false, first)).rejects.toBeTruthy()
  })

  it('encrypts file metadata', async () => {
    const { dek, nonce } = await newFileKey()
    const enc = await encryptMeta(dek, nonce, { name: 'Báo cáo.pdf', mime: 'application/pdf' })
    expect(await decryptMeta(dek, nonce, enc)).toEqual({ name: 'Báo cáo.pdf', mime: 'application/pdf' })
  })
})

describe('vault', () => {
  it('wraps file keys and survives a password change', { timeout: 30000 }, async () => {
    const { vaultKey, fields } = await createVault('correct horse')
    const { dek } = await newFileKey()
    const wrapped = await wrapFileKey(vaultKey, dek)

    const record = { salt: fields.s, iterations: Number(fields.it), wrapped: fields.w }
    await expect(unlockVault(record, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
    const reopened = await unlockVault(record, 'correct horse')
    await unwrapFileKey(reopened, wrapped)

    const changed = await rewrapVault(reopened, 'new pass')
    const again = await unlockVault({ salt: changed.s, iterations: Number(changed.it), wrapped: changed.w }, 'new pass')
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', again))
    expect(raw).toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)))
  })
})
