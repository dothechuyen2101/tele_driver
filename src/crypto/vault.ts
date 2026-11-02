/**
 * End-to-end encryption vault.
 *
 *   password ──PBKDF2-SHA256──► password key (AES-KW)
 *   password key wraps a random vault key  → stored in the `#td_vault` message (w=)
 *   vault key wraps one random key per file → stored in the file caption (e=)
 *
 * Changing the password re-wraps only the vault key, one message edit.
 * A wrong password fails the AES-KW integrity check, so no extra verifier is needed.
 */
import { fromBase64Url, randomBytes, toArrayBuffer, toBase64Url, utf8 } from '@/lib/bytes'

export const VAULT_ITERATIONS = 600_000

export class WrongPasswordError extends Error {
  constructor() {
    super('WRONG_PASSWORD')
    this.name = 'WrongPasswordError'
  }
}

export interface VaultFields {
  s: string
  it: string
  w: string
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', toArrayBuffer(utf8(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function wrapVaultKey(vaultKey: CryptoKey, password: string): Promise<VaultFields> {
  const salt = randomBytes(16)
  const pk = await passwordKey(password, salt, VAULT_ITERATIONS)
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, pk, 'AES-KW')
  return { s: toBase64Url(salt), it: String(VAULT_ITERATIONS), w: toBase64Url(new Uint8Array(wrapped)) }
}

export async function createVault(password: string) {
  const vaultKey = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey', 'unwrapKey'])
  return { vaultKey, fields: await wrapVaultKey(vaultKey, password) }
}

export async function unlockVault(record: { salt: string; iterations: number; wrapped: string }, password: string) {
  const pk = await passwordKey(password, fromBase64Url(record.salt), record.iterations)
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      toArrayBuffer(fromBase64Url(record.wrapped)),
      pk,
      'AES-KW',
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey'],
    )
  } catch {
    throw new WrongPasswordError()
  }
}

export function rewrapVault(vaultKey: CryptoKey, newPassword: string) {
  return wrapVaultKey(vaultKey, newPassword)
}

export async function exportVaultKey(vaultKey: CryptoKey) {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)))
}

export function importVaultKey(raw: string) {
  return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64Url(raw)), { name: 'AES-KW', length: 256 }, true, [
    'wrapKey',
    'unwrapKey',
  ])
}

export async function newFileKey() {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return { dek, nonce: randomBytes(8) }
}

export async function wrapFileKey(vaultKey: CryptoKey, dek: CryptoKey) {
  return toBase64Url(new Uint8Array(await crypto.subtle.wrapKey('raw', dek, vaultKey, 'AES-KW')))
}

const fileKeyCache = new Map<string, Promise<CryptoKey>>()

export function unwrapFileKey(vaultKey: CryptoKey, wrapped: string) {
  let p = fileKeyCache.get(wrapped)
  if (!p) {
    p = crypto.subtle.unwrapKey('raw', toArrayBuffer(fromBase64Url(wrapped)), vaultKey, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    p.catch(() => fileKeyCache.delete(wrapped))
    fileKeyCache.set(wrapped, p)
  }
  return p
}

export function clearFileKeyCache() {
  fileKeyCache.clear()
}
