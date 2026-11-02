import { db, entryId, type Entry } from '@/db/db'
import { mapLimit } from '@/lib/utils'
import { requireStorage, useDrive } from '@/stores/app'
import { CAPTION_LIMIT, composeText, folderRef, mergeFields, serializeTag, type TagFields } from './metadata'
import { buildIndex, isDescendant, subtreeMessageIds, type DriveFile, type DriveFolder, type DriveIndex, type DriveItem } from './model'
import { deleteMessages, editText, sendText, toEntry } from '@/telegram/messages'
import { EDIT_REFUSED, isRpc } from '@/telegram/errors'
import { chatKeyOf } from '@/telegram/peers'
import { rememberMessage } from '@/telegram/download'
import { decryptMeta, encryptMeta } from '@/crypto/chunkCipher'
import { unwrapFileKey } from '@/crypto/vault'
import { fromBase64Url } from '@/lib/bytes'

const now = () => Math.floor(Date.now() / 1000)

/**
 * Changes tag fields of one message: edits it in place when Telegram allows,
 * otherwise appends a `#td_patch` message that overrides those fields.
 */
export async function applyFields(entry: Entry, change: TagFields) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const hasPatches = (useDrive.getState().index.patches.get(entry.msgId)?.length ?? 0) > 0
  if (entry.canEdit && !hasPatches) {
    const kind = entry.kind === 'patch' ? 'file' : entry.kind
    const fields = mergeFields(entry.fields, change)
    const text = composeText(entry.userText, kind, fields)
    if (text.length <= CAPTION_LIMIT || !entry.media) {
      try {
        const msg = await editText(ref, entry.msgId, text)
        if (msg) {
          rememberMessage(ref, msg)
          const e = toEntry(chatKey, msg)
          if (e) await db.entries.put(e)
        } else {
          await db.entries.put({ ...entry, fields: { ...fields, v: '1' } })
        }
        return
      } catch (err) {
        if (isRpc(err, 'MESSAGE_NOT_MODIFIED')) return
        if (!isRpc(err, ...EDIT_REFUSED)) throw err
      }
    }
  }
  const fields = { m: String(entry.msgId), ...change }
  const sent = await sendText(ref, serializeTag('patch', fields))
  await db.entries.put({
    id: entryId(chatKey, sent.id),
    chatKey,
    msgId: sent.id,
    kind: 'patch',
    date: sent.date,
    fields: { v: '1', ...fields },
    userText: '',
    canEdit: true,
  })
}

async function applyToFile(file: DriveFile, change: TagFields) {
  for (const part of file.parts) await applyFields(part.entry, change)
}

export async function createFolder(parentId: number, name: string, encrypted = false) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const fields: TagFields = { p: folderRef(parentId), n: name.trim() }
  if (encrypted) fields.e = '1'
  const sent = await sendText(ref, serializeTag('dir', fields))
  await db.entries.put({
    id: entryId(chatKey, sent.id),
    chatKey,
    msgId: sent.id,
    kind: 'dir',
    date: sent.date,
    fields: { v: '1', ...fields },
    userText: '',
    canEdit: true,
  })
  return sent.id
}

/** Finds a live child folder by name, or creates it. Used by folder uploads. */
export async function ensureFolder(parentId: number, name: string, encrypted = false) {
  const { index } = useDrive.getState()
  const existing = (index.childFolders.get(parentId) ?? []).find((f) => !f.trashedAt && f.name === name)
  if (existing) return existing.id
  return createFolder(parentId, name, encrypted)
}

export async function renameItem(item: DriveItem, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  if (item.type === 'folder') return applyFields(item.entry, { n: trimmed })
  if (item.enc) {
    const key = useDrive.getState().vaultKey
    if (!key) throw new Error('VAULT_LOCKED')
    const dek = await unwrapFileKey(key, item.enc.wrappedKey)
    const nonce = fromBase64Url(item.enc.nonce)
    const meta = item.enc.encName ? await decryptMeta(dek, nonce, item.enc.encName) : { name: item.name, mime: item.mime }
    const en = await encryptMeta(dek, nonce, { ...meta, name: trimmed })
    await applyToFile(item, { en })
    useDrive.setState((s) => ({ decrypted: new Map(s.decrypted).set(en, { ...meta, name: trimmed }) }))
    return
  }
  return applyToFile(item, { n: trimmed })
}

export async function setFolderEncrypted(folder: DriveFolder, encrypted: boolean) {
  return applyFields(folder.entry, { e: encrypted ? '1' : '' })
}

export function canMoveInto(items: DriveItem[], targetId: number) {
  const { index } = useDrive.getState()
  return items.every((i) => (i.type === 'folder' ? i.id !== targetId && !isDescendant(index, targetId, i.id) && i.parentId !== targetId : i.folderId !== targetId))
}

export async function moveItems(items: DriveItem[], targetId: number, onProgress?: (done: number) => void) {
  let done = 0
  await mapLimit(items, 3, async (item) => {
    if (item.type === 'folder') {
      if (item.id === targetId || isDescendant(useDrive.getState().index, targetId, item.id)) return
      await applyFields(item.entry, { p: folderRef(targetId) })
    } else await applyToFile(item, { f: folderRef(targetId) })
    onProgress?.(++done)
  })
}

export async function trashItems(items: DriveItem[]) {
  const t = String(now())
  await mapLimit(items, 3, (item) => (item.type === 'folder' ? applyFields(item.entry, { t }) : applyToFile(item, { t })))
}

export async function restoreItems(items: DriveItem[]) {
  await mapLimit(items, 3, (item) => (item.type === 'folder' ? applyFields(item.entry, { t: '' }) : applyToFile(item, { t: '' })))
}

/** Deletes items from Telegram for good, including folder contents and patch records. */
export async function purgeItems(items: DriveItem[], index: DriveIndex = useDrive.getState().index) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const ids = new Set<number>()
  for (const item of items) {
    if (item.type === 'folder') for (const id of subtreeMessageIds(index, item.id)) ids.add(id)
    else for (const p of item.parts) ids.add(p.msgId)
  }
  for (const id of [...ids]) for (const p of index.patches.get(id) ?? []) ids.add(p.msgId)
  const list = [...ids]
  await deleteMessages(ref, list)
  await db.entries.bulkDelete(list.map((id) => entryId(chatKey, id)))
}

export async function emptyTrash() {
  await purgeItems(useDrive.getState().index.trashed)
}

/** Permanently removes items that have been in the trash for more than `days`. */
export async function autoPurgeTrash(days = 30) {
  const { ref } = requireStorage()
  // Build from the database directly: the UI index may not have caught up with the sync yet.
  const index = buildIndex(await db.entries.where('chatKey').equals(chatKeyOf(ref)).toArray())
  const cutoff = now() - days * 86400
  const old = index.trashed.filter((i) => (i.trashedAt ?? Infinity) < cutoff)
  if (old.length) await purgeItems(old, index)
  return old.length
}
