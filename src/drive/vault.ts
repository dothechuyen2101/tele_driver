import { db, entryId } from '@/db/db'
import { delSecret, getSecret, hasPasscode, setSecret } from '@/crypto/secrets'
import {
  clearFileKeyCache,
  createVault,
  exportVaultKey,
  importVaultKey,
  rewrapVault,
  unlockVault,
  unwrapFileKey,
} from '@/crypto/vault'
import { decryptMeta } from '@/crypto/chunkCipher'
import { fromBase64Url } from '@/lib/bytes'
import { requireStorage, useDrive } from '@/stores/app'
import { sendText } from '@/telegram/messages'
import { chatKeyOf } from '@/telegram/peers'
import { serializeTag } from './metadata'
import { applyFields } from './ops'
import type { DecryptedMeta, DriveIndex } from './model'
import { syncStorage } from './sync'

const secretName = (chatKey: string) => `vault:${chatKey}`

async function setKey(key: CryptoKey) {
  const { ref } = requireStorage()
  useDrive.setState({ vaultKey: key })
  if (await hasPasscode()) await setSecret(secretName(chatKeyOf(ref)), await exportVaultKey(key))
}

export async function createVaultForStorage(password: string) {
  const { ref } = requireStorage()
  // Another device may have created one meanwhile; never create two.
  await syncStorage(ref)
  if (useDrive.getState().index.vault) throw new Error('VAULT_EXISTS')
  const chatKey = chatKeyOf(ref)
  const { vaultKey, fields } = await createVault(password)
  const sent = await sendText(ref, serializeTag('vault', { ...fields }))
  await db.entries.put({
    id: entryId(chatKey, sent.id),
    chatKey,
    msgId: sent.id,
    kind: 'vault',
    date: sent.date,
    fields: { v: '1', ...fields },
    userText: '',
    canEdit: true,
  })
  await setKey(vaultKey)
}

export async function unlockVaultForStorage(password: string) {
  const vault = useDrive.getState().index.vault
  if (!vault) throw new Error('NO_VAULT')
  await setKey(await unlockVault(vault, password))
}

export async function changeVaultPassword(newPassword: string) {
  const { vaultKey, index } = useDrive.getState()
  if (!vaultKey || !index.vault) throw new Error('VAULT_LOCKED')
  const entry = await db.entries.get(entryId(chatKeyOf(requireStorage().ref), index.vault.msgId))
  if (!entry) throw new Error('NO_VAULT')
  await applyFields(entry, { ...(await rewrapVault(vaultKey, newPassword)) })
}

/** Restores the vault key cached (sealed by the passcode) on this device. */
export async function restoreVaultKey() {
  const { ref } = requireStorage()
  try {
    const raw = await getSecret<string>(secretName(chatKeyOf(ref)))
    if (raw) useDrive.setState({ vaultKey: await importVaultKey(raw) })
  } catch {
    /* locked or corrupt; the user can unlock again */
  }
}

export async function lockVault() {
  const { ref } = requireStorage()
  clearFileKeyCache()
  useDrive.setState({ vaultKey: undefined, decrypted: new Map() })
  await delSecret(secretName(chatKeyOf(ref)))
}

/** Decrypts names of encrypted files that are not decrypted yet. */
export async function decryptPendingNames(index: DriveIndex, key: CryptoKey) {
  const { decrypted } = useDrive.getState()
  const added = new Map<string, DecryptedMeta>()
  for (const f of index.files.values()) {
    const en = f.enc?.encName
    if (!en || decrypted.has(en) || added.has(en)) continue
    try {
      const dek = await unwrapFileKey(key, f.enc!.wrappedKey)
      added.set(en, await decryptMeta(dek, fromBase64Url(f.enc!.nonce), en))
    } catch {
      /* encrypted with another vault key */
    }
  }
  if (added.size) useDrive.setState((s) => ({ decrypted: new Map([...s.decrypted, ...added]) }))
}
