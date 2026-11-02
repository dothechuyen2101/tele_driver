import bigInt from 'big-integer'
import { Api } from 'teleproto'
import { db, type ImportJobRow, type ImportItemRow, type MediaInfo } from '@/db/db'
import { blockSource } from '@/lib/byteSource'
import { concatBytes } from '@/lib/bytes'
import { requireStorage, useApp } from '@/stores/app'
import { getClient } from '@/telegram/client'
import { getMessage, readMessageRange, rememberMessage } from '@/telegram/download'
import { isRpc } from '@/telegram/errors'
import { getHistoryPage, mediaInfo, toEntry } from '@/telegram/messages'
import { chatKeyOf, inputPeer, peerFromKey, type PeerRef } from '@/telegram/peers'
import { sendMedia } from '@/telegram/upload'
import { inputMediaOf } from '../forward'
import { CAPTION_LIMIT, composeText, folderRef, serializeTag } from '../metadata'
import { mediaFileName } from '../model'
import { uploadImportSource, type ImportSource } from '../uploads'

/** d(ocuments) p(hotos) v(ideos) a(udio). */
export type MediaKind = 'd' | 'p' | 'v' | 'a'
export const MEDIA_KINDS: MediaKind[] = ['d', 'p', 'v', 'a']

export interface ScanItem {
  msgId: number
  key: string
  name: string
  size: number
  mime: string
  date: number
  kind: MediaKind
}

/** Thrown for items that are deliberately not imported (protected chat, gone, empty…). */
export class SkipError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'SkipError'
    this.reason = reason
  }
}

export const tgSourceKey = (peer: PeerRef, msgId: number) => `tg:${chatKeyOf(peer)}:${msgId}`

export function classify(m: MediaInfo): MediaKind {
  if (m.kind === 'photo') return 'p'
  if (m.mime.startsWith('video/')) return 'v'
  if (m.mime.startsWith('audio/')) return 'a'
  return 'd'
}

function itemOf(peer: PeerRef, msg: Api.TypeMessage): ScanItem | null {
  if (!(msg instanceof Api.Message)) return null
  const m = mediaInfo(msg.media)
  if (!m || m.size <= 0) return null
  return { msgId: msg.id, key: tgSourceKey(peer, msg.id), name: mediaFileName(m, msg.date), size: m.size, mime: m.mime, date: msg.date, kind: classify(m) }
}

const FILTERS: Record<MediaKind, () => Api.TypeMessagesFilter> = {
  d: () => new Api.InputMessagesFilterDocument(),
  p: () => new Api.InputMessagesFilterPhotos(),
  v: () => new Api.InputMessagesFilterVideo(),
  a: () => new Api.InputMessagesFilterMusic(),
}

export interface ScanOptions {
  kinds: MediaKind[]
  /** Unix seconds, inclusive. */
  from?: number
  to?: number
  signal?: AbortSignal
  onProgress?: (found: number, total: number) => void
}

/** Lists the media of a chat, oldest first, using Telegram's server-side filters. */
export async function scanChat(peer: PeerRef, { kinds, from, to, signal, onProgress }: ScanOptions): Promise<ScanItem[]> {
  const found = new Map<number, ScanItem>()
  const totals = new Map<MediaKind, number>()
  for (const kind of kinds) {
    let offsetId = 0
    for (;;) {
      signal?.throwIfAborted()
      const res = await getClient().invoke(
        new Api.messages.Search({
          peer: inputPeer(peer),
          q: '',
          filter: FILTERS[kind](),
          minDate: from ?? 0,
          maxDate: to ?? 0,
          offsetId,
          addOffset: 0,
          limit: 100,
          maxId: 0,
          minId: 0,
          hash: bigInt.zero,
        }),
      )
      if (res instanceof Api.messages.MessagesNotModified) break
      if ('count' in res) totals.set(kind, res.count)
      for (const msg of res.messages) {
        const item = itemOf(peer, msg)
        if (item && kinds.includes(item.kind)) found.set(item.msgId, item)
      }
      onProgress?.(found.size, [...totals.values()].reduce((a, b) => a + b, 0))
      if (res.messages.length < 100) break
      offsetId = res.messages[res.messages.length - 1].id
    }
  }
  return [...found.values()].sort((a, b) => a.msgId - b.msgId)
}

/**
 * Media posted after `afterId`, for followed chats. Also returns the newest
 * message id seen. History is read newest-first, so the cap is generous: posts
 * older than the cap would be skipped for good once the bookmark moves on.
 */
export async function fetchNewMedia(peer: PeerRef, afterId: number, kinds: string, max = 20_000) {
  const items: ScanItem[] = []
  let maxId = afterId
  let offsetId = 0
  let scanned = 0
  for (;;) {
    const { messages } = await getHistoryPage(peer, { offsetId, minId: afterId, limit: 100 })
    if (!messages.length) break
    for (const msg of messages) {
      maxId = Math.max(maxId, msg.id)
      const item = itemOf(peer, msg)
      if (item && kinds.includes(item.kind)) items.push(item)
    }
    scanned += messages.length
    offsetId = messages[messages.length - 1].id
    if (messages.length < 100 || scanned >= max) break
  }
  return { items: items.sort((a, b) => a.msgId - b.msgId), maxId }
}

function trimCaption(text: string, tagLength: number) {
  const room = CAPTION_LIMIT - tagLength - 1
  return text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`
}

function sourcePeer(job: ImportJobRow): PeerRef {
  const p = job.peer && peerFromKey(job.peer.key, job.peer.accessHash, job.peer.title)
  if (!p) throw new SkipError('source')
  return p
}

/**
 * Copies one message's media into the storage chat. Plain folders get a copy
 * by reference (instant, no re-upload); encrypted folders need the bytes, so
 * the file is downloaded, encrypted and uploaded again.
 */
export async function importTelegramItem(job: ImportJobRow, item: ImportItemRow, folderId: number, signal: AbortSignal, onBytes: (n: number) => void) {
  const { ref } = requireStorage()
  const chatKey = chatKeyOf(ref)
  const src = sourcePeer(job)
  let msg: Api.Message
  try {
    msg = await getMessage(src, item.msgId!)
  } catch (err) {
    if (err instanceof Error && err.message === 'FILE_GONE') throw new SkipError('gone')
    throw err
  }
  if (msg.noforwards) throw new SkipError('protected')

  if (job.encrypt) {
    const size = mediaInfo(msg.media)?.size ?? item.size
    const source: ImportSource = {
      name: item.name,
      mime: item.mime,
      srcTag: item.key,
      ...blockSource(size, async (start, end) => {
        const parts: Uint8Array[] = []
        for await (const chunk of readMessageRange(src, item.msgId!, start, end - start, signal)) parts.push(chunk.slice())
        return concatBytes(parts)
      }),
    }
    await uploadImportSource(source, folderId, { encrypt: true, signal, onBytes })
    return
  }

  const tag = serializeTag('file', { f: folderRef(folderId), s: item.key })
  const caption = composeText(job.keepCaptions ? trimCaption(msg.message ?? '', tag.length) : '', 'file', { f: folderRef(folderId), s: item.key })
  for (let attempt = 0; ; attempt++) {
    try {
      const sent = await sendMedia(ref, inputMediaOf(attempt ? await getMessage(src, item.msgId!, true) : msg), caption)
      rememberMessage(ref, sent)
      const entry = toEntry(chatKey, sent)
      if (entry) await db.entries.put(entry)
      onBytes(item.size)
      return
    } catch (err) {
      if (attempt === 0 && isRpc(err, 'FILE_REFERENCE_')) continue
      if (isRpc(err, 'CHAT_FORWARDS_RESTRICTED')) throw new SkipError('protected')
      throw err
    }
  }
}

/** The storage chat itself is never offered as a source. */
export function isStorageChat(peer: PeerRef) {
  const storage = useApp.getState().storage
  return !!storage && chatKeyOf(storage) === chatKeyOf(peer)
}
