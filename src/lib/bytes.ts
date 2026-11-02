const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const utf8 = (s: string) => encoder.encode(s)
export const fromUtf8 = (b: Uint8Array) => decoder.decode(b)

export function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function toBase64Url(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Short random id using a URL-safe alphabet. */
export function randomId(len = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(len)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

/** Copies into a standalone ArrayBuffer (WebCrypto and postMessage transfer want one). */
export function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && b.buffer instanceof ArrayBuffer
    ? b.buffer
    : (b.slice().buffer as ArrayBuffer)
}
