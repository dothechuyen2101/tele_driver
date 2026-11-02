import Dexie, { type EntityTable } from 'dexie'

export type EntryKind = 'file' | 'dir' | 'patch' | 'vault'

export interface MediaInfo {
  kind: 'document' | 'photo'
  /** Telegram document/photo id, kept as a string (it is a 64-bit integer). */
  id: string
  size: number
  mime: string
  fileName?: string
  w?: number
  h?: number
  duration?: number
  /** Base64 of the tiny "stripped" JPEG Telegram inlines into the message. */
  stripped?: string
  /** PhotoSize type of a downloadable thumbnail, if one exists. */
  thumbType?: string
}

/** One Telegram message of the storage chat that TeleDriver cares about. */
export interface Entry {
  id: string // `${chatKey}:${msgId}`
  chatKey: string
  msgId: number
  kind: EntryKind
  date: number
  editDate?: number
  /** Parsed `#td…` tag fields. Empty for untagged media. */
  fields: Record<string, string>
  /** Caption text without the tag line. */
  userText: string
  /** Whether we may edit this message in place (own and not forwarded). */
  canEdit: boolean
  media?: MediaInfo
}

export interface KvRow {
  key: string
  value: unknown
}

export interface ThumbRow {
  id: string
  blob: Blob
  at: number
}

export interface SyncStateRow {
  chatKey: string
  maxId: number
  lastFullSync: number
}

export const db = new Dexie('teledriver') as Dexie & {
  kv: EntityTable<KvRow, 'key'>
  entries: EntityTable<Entry, 'id'>
  thumbs: EntityTable<ThumbRow, 'id'>
  syncState: EntityTable<SyncStateRow, 'chatKey'>
}

db.version(1).stores({
  kv: '&key',
  entries: '&id, chatKey, [chatKey+msgId]',
  thumbs: '&id, at',
  syncState: '&chatKey',
})

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value })
}

export async function kvDel(key: string) {
  await db.kv.delete(key)
}

export const entryId = (chatKey: string, msgId: number) => `${chatKey}:${msgId}`

export async function wipeAll() {
  await db.delete()
  await db.open()
}
