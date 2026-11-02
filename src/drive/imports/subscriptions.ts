/**
 * Followed sources (`#td_sub` records in the storage chat). Telegram chats are
 * checked when the app opens and every few minutes while it stays open; Google
 * Drive folders are re-synced on demand (a Google token needs a click).
 */
import { db, entryId } from '@/db/db'
import { requireStorage } from '@/stores/app'
import { ensureToken } from '@/google/auth'
import { listTree } from '@/google/drive'
import { deleteMessages, sendText } from '@/telegram/messages'
import { accessHashOf, chatKeyOf, peerFromKey, type SourceChat } from '@/telegram/peers'
import { folderRef, serializeTag, type TagFields } from '../metadata'
import { buildIndex, type DriveIndex, type Subscription } from '../model'
import { applyFields } from '../ops'
import { syncStorage } from '../sync'
import { needsEncryption } from '../uploads'
import { createImport } from './runner'
import { fetchNewMedia, type ScanItem } from './telegram'

const CHECK_EVERY_MS = 5 * 60 * 1000
const nowSec = () => String(Math.floor(Date.now() / 1000))

export const scanItemToImport = (i: ScanItem) => ({ key: i.key, name: i.name, size: i.size, mime: i.mime, msgId: i.msgId })

async function addSub(fields: TagFields) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const sent = await sendText(ref, serializeTag('sub', fields))
  await db.entries.put({ id: entryId(chatKey, sent.id), chatKey, msgId: sent.id, kind: 'sub', date: sent.date, fields: { v: '1', ...fields }, userText: '', canEdit: true })
}

/** Follows a chat: new media posted after message `last` is imported into `folderId`. */
export function followChat(src: SourceChat, folderId: number, kinds: string, last: number) {
  return addSub({ c: chatKeyOf(src.ref), h: accessHashOf(src.ref), n: src.ref.title, f: folderRef(folderId), k: kinds, l: String(last), a: '1', t: nowSec() })
}

/** Remembers a Google Drive folder so it can be re-synced later (new files only). */
export function followDriveFolder(driveFolderId: string, title: string, folderId: number) {
  return addSub({ c: `gd:${driveFolderId}`, n: title, f: folderRef(folderId), a: '0', t: nowSec() })
}

export function setSubscriptionPaused(sub: Subscription, paused: boolean) {
  return applyFields(sub.entry, { p: paused ? '1' : '' })
}

export async function unfollow(sub: Subscription, index: DriveIndex) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const ids = [sub.msgId, ...(index.patches.get(sub.msgId) ?? []).map((p) => p.msgId)]
  await deleteMessages(ref, ids)
  await db.entries.bulkDelete(ids.map((id) => entryId(chatKey, id)))
}

/** Index straight from the database: the UI copy may lag right after a sync. */
async function freshIndex() {
  const { ref } = requireStorage()
  return buildIndex(await db.entries.where('chatKey').equals(chatKeyOf(ref)).toArray())
}

async function hasOpenJob(subMsgId: number) {
  const { ref } = requireStorage()
  const jobs = await db.imports.where('chatKey').equals(chatKeyOf(ref)).toArray()
  return jobs.some((j) => j.sub?.msgId === subMsgId && !['done', 'canceled', 'error'].includes(j.status))
}

/** Queues media posted in a followed chat since the last run; returns how many files were queued. */
export async function runChatSubscription(sub: Subscription, index: DriveIndex): Promise<number> {
  const peer = peerFromKey(sub.source, sub.accessHash, sub.title)
  if (!peer || (await hasOpenJob(sub.msgId))) return 0
  const { items, maxId } = await fetchNewMedia(peer, sub.last, sub.kinds)
  const fresh = items.filter((i) => !index.sources.has(i.key))
  if (!fresh.length) {
    if (maxId > sub.last) await applyFields(sub.entry, { l: String(maxId), t: nowSec() })
    return 0
  }
  await createImport(
    {
      kind: 'tg',
      title: sub.title,
      folderId: sub.folderId,
      encrypt: needsEncryption(sub.folderId),
      keepCaptions: true,
      peer: { key: sub.source, accessHash: sub.accessHash, title: sub.title },
      sub: { msgId: sub.msgId, last: maxId },
    },
    fresh.map(scanItemToImport),
  )
  return fresh.length
}

/** Re-scans a followed Google Drive folder and queues files not imported yet. Call from a click. */
export async function runDriveSubscription(sub: Subscription): Promise<number> {
  if (await hasOpenJob(sub.msgId)) return 0
  const token = await ensureToken('readonly')
  const index = await freshIndex()
  const entries = await listTree(sub.source.slice(3), token)
  const fresh = entries.filter((e) => !e.skip && !index.sources.has(`gd:${e.fileId}`))
  if (!fresh.length) {
    await applyFields(sub.entry, { t: nowSec() })
    return 0
  }
  await createImport(
    { kind: 'gd', title: sub.title, folderId: sub.folderId, encrypt: needsEncryption(sub.folderId), keepCaptions: false, sub: { msgId: sub.msgId, last: Number(nowSec()) } },
    fresh.map((e) => ({ key: `gd:${e.fileId}`, name: e.name, size: e.size, mime: e.mime, fileId: e.fileId, exportMime: e.exportMime, dir: e.dir })),
  )
  return fresh.length
}

let running = false

/** Checks every followed Telegram chat once. */
export async function runSubscriptions() {
  if (running) return
  running = true
  try {
    const { ref } = requireStorage()
    await syncStorage(ref)
    const index = await freshIndex()
    for (const sub of index.subs) {
      if (!sub.auto || sub.paused || sub.source.startsWith('gd:')) continue
      await runChatSubscription(sub, index).catch((err) => console.warn('follow', sub.title, err))
    }
  } finally {
    running = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined

export function startSubscriptionTimer() {
  stopSubscriptionTimer()
  timer = setInterval(() => void runSubscriptions().catch(() => {}), CHECK_EVERY_MS)
}

export function stopSubscriptionTimer() {
  clearInterval(timer)
  timer = undefined
}
