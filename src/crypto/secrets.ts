/**
 * Local secrets (API credentials, Telegram session, cached vault keys).
 * Without a passcode they are stored as-is in IndexedDB; with one they are
 * sealed with AES-GCM under a key derived from the passcode, which lives only
 * in memory while the app is unlocked.
 */
import { db, kvDel, kvGet, kvSet } from '@/db/db'
import { fromBase64Url, fromUtf8, randomBytes, toArrayBuffer, toBase64Url, utf8 } from '@/lib/bytes'

const PASSCODE_KEY = 'passcode'
const PREFIX = 'secret:'
const ITERATIONS = 600_000
const CHECK = 'teledriver-passcode-check'

interface Sealed {
  $sealed: 1
  iv: string
  ct: string
}

interface PasscodeMeta {
  salt: string
  iterations: number
  check: Sealed
}

let sessionKey: CryptoKey | null = null

const isSealed = (v: unknown): v is Sealed => typeof v === 'object' && v !== null && (v as Sealed).$sealed === 1

async function deriveKey(code: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', toArrayBuffer(utf8(code)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function seal(key: CryptoKey, plain: string): Promise<Sealed> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(utf8(plain)))
  return { $sealed: 1, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) }
}

async function unseal(key: CryptoKey, s: Sealed): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64Url(s.iv)) },
    key,
    toArrayBuffer(fromBase64Url(s.ct)),
  )
  return fromUtf8(new Uint8Array(pt))
}

export async function hasPasscode() {
  return !!(await kvGet<PasscodeMeta>(PASSCODE_KEY))
}

export function isUnlocked() {
  return sessionKey !== null
}

export async function unlock(code: string) {
  const meta = await kvGet<PasscodeMeta>(PASSCODE_KEY)
  if (!meta) return true
  const key = await deriveKey(code, fromBase64Url(meta.salt), meta.iterations)
  try {
    if ((await unseal(key, meta.check)) !== CHECK) return false
  } catch {
    return false
  }
  sessionKey = key
  return true
}

export function lock() {
  sessionKey = null
}

async function allSecretRows() {
  return db.kv.where('key').startsWith(PREFIX).toArray()
}

/** Turns a passcode on, or changes it (the app must be unlocked). */
export async function setPasscode(code: string) {
  const rows = await allSecretRows()
  const plain = await Promise.all(rows.map(async (r) => [r.key, await readRaw(r.value)] as const))
  const salt = randomBytes(16)
  const key = await deriveKey(code, salt, ITERATIONS)
  const meta: PasscodeMeta = { salt: toBase64Url(salt), iterations: ITERATIONS, check: await seal(key, CHECK) }
  const sealed = await Promise.all(plain.map(async ([k, v]) => ({ key: k, value: v === undefined ? undefined : await seal(key, v) })))
  await db.transaction('rw', db.kv, async () => {
    await db.kv.put({ key: PASSCODE_KEY, value: meta })
    for (const row of sealed) if (row.value) await db.kv.put(row)
  })
  sessionKey = key
}

export async function removePasscode() {
  const rows = await allSecretRows()
  const plain = await Promise.all(rows.map(async (r) => [r.key, await readRaw(r.value)] as const))
  await db.transaction('rw', db.kv, async () => {
    await db.kv.delete(PASSCODE_KEY)
    for (const [k, v] of plain) if (v !== undefined) await db.kv.put({ key: k, value: v })
  })
  sessionKey = null
}

async function readRaw(value: unknown): Promise<string | undefined> {
  if (value === undefined) return undefined
  if (isSealed(value)) {
    if (!sessionKey) throw new Error('LOCKED')
    return unseal(sessionKey, value)
  }
  return value as string
}

export async function getSecret<T>(name: string): Promise<T | undefined> {
  const raw = await readRaw(await kvGet(PREFIX + name))
  return raw === undefined ? undefined : (JSON.parse(raw) as T)
}

export async function setSecret(name: string, value: unknown) {
  const json = JSON.stringify(value)
  if (await hasPasscode()) {
    if (!sessionKey) throw new Error('LOCKED')
    await kvSet(PREFIX + name, await seal(sessionKey, json))
  } else {
    await kvSet(PREFIX + name, json)
  }
}

export async function delSecret(name: string) {
  await kvDel(PREFIX + name)
}
