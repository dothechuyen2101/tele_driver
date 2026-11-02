import bigInt from 'big-integer'
import { Api } from 'teleproto'
import { generateRandomLong } from 'teleproto/Helpers'
import type { Entry, MediaInfo } from '@/db/db'
import { entryId } from '@/db/db'
import { toBase64Url } from '@/lib/bytes'
import { parseTagged } from '@/drive/metadata'
import { getClient } from './client'
import { inputChannel, inputPeer, type PeerRef, type StorageRef } from './peers'

type BigLike = number | { toJSNumber(): number }
const num = (v: BigLike | undefined | null) => (v == null ? 0 : typeof v === 'number' ? v : v.toJSNumber())

export async function getHistoryPage(ref: PeerRef, opts: { offsetId?: number; minId?: number; limit?: number }) {
  const res = await getClient().invoke(
    new Api.messages.GetHistory({
      peer: inputPeer(ref),
      offsetId: opts.offsetId ?? 0,
      offsetDate: 0,
      addOffset: 0,
      limit: opts.limit ?? 100,
      maxId: 0,
      minId: opts.minId ?? 0,
      hash: bigInt.zero,
    }),
  )
  if (res instanceof Api.messages.MessagesNotModified) return { messages: [], count: res.count }
  const count = 'count' in res ? res.count : res.messages.length
  return { messages: res.messages, count }
}

export async function fetchMessages(ref: PeerRef, ids: number[]): Promise<Map<number, Api.Message>> {
  const out = new Map<number, Api.Message>()
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).map((id) => new Api.InputMessageID({ id }))
    const res =
      ref.kind === 'channel'
        ? await getClient().invoke(new Api.channels.GetMessages({ channel: inputChannel(ref), id: batch }))
        : await getClient().invoke(new Api.messages.GetMessages({ id: batch }))
    if (res instanceof Api.messages.MessagesNotModified) continue
    for (const m of res.messages) if (m instanceof Api.Message) out.set(m.id, m)
  }
  return out
}

/** Pulls the message objects out of an Updates result. */
export function extractMessages(result: Api.TypeUpdates | unknown): Api.Message[] {
  const updates: Api.TypeUpdate[] = []
  if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) updates.push(...result.updates)
  else if (result instanceof Api.UpdateShort) updates.push(result.update)
  const out: Api.Message[] = []
  for (const u of updates) {
    if (
      u instanceof Api.UpdateNewMessage ||
      u instanceof Api.UpdateNewChannelMessage ||
      u instanceof Api.UpdateEditMessage ||
      u instanceof Api.UpdateEditChannelMessage
    ) {
      if (u.message instanceof Api.Message) out.push(u.message)
    }
  }
  return out
}

function sentId(result: unknown): { id: number; date: number } | undefined {
  if (result instanceof Api.UpdateShortSentMessage) return { id: result.id, date: result.date }
  const msg = extractMessages(result)[0]
  if (msg) return { id: msg.id, date: msg.date }
  if (result instanceof Api.Updates) {
    const u = result.updates.find((x): x is Api.UpdateMessageID => x instanceof Api.UpdateMessageID)
    if (u) return { id: u.id, date: Math.floor(Date.now() / 1000) }
  }
  return undefined
}

export async function sendText(ref: StorageRef, text: string) {
  const result = await getClient().invoke(
    new Api.messages.SendMessage({ peer: inputPeer(ref), message: text, noWebpage: true, randomId: generateRandomLong() }),
  )
  const sent = sentId(result)
  if (!sent) throw new Error('Telegram did not return the sent message')
  return sent
}

export async function editText(ref: StorageRef, msgId: number, text: string) {
  const result = await getClient().invoke(
    new Api.messages.EditMessage({ peer: inputPeer(ref), id: msgId, message: text, noWebpage: true }),
  )
  return extractMessages(result)[0]
}

export async function deleteMessages(ref: StorageRef, ids: number[]) {
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    if (ref.kind === 'channel') await getClient().invoke(new Api.channels.DeleteMessages({ channel: inputChannel(ref), id: batch }))
    else await getClient().invoke(new Api.messages.DeleteMessages({ id: batch, revoke: true }))
  }
}

function pickThumb(sizes: Api.TypePhotoSize[] | undefined) {
  let stripped: string | undefined
  let thumbType: string | undefined
  let best = 0
  for (const s of sizes ?? []) {
    if (s instanceof Api.PhotoStrippedSize) stripped = toBase64Url(new Uint8Array(s.bytes))
    else if (s instanceof Api.PhotoSize || s instanceof Api.PhotoSizeProgressive || s instanceof Api.PhotoCachedSize) {
      // Prefer the ~320px "m" size; otherwise the largest that is still small.
      const score = s.type === 'm' ? 1000 : s.w <= 400 ? s.w : 0
      if (score > best) {
        best = score
        thumbType = s.type
      }
    }
  }
  return { stripped, thumbType }
}

export function mediaInfo(media: Api.TypeMessageMedia | undefined): MediaInfo | undefined {
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document
    const info: MediaInfo = { kind: 'document', id: doc.id.toString(), size: num(doc.size), mime: doc.mimeType || 'application/octet-stream' }
    for (const a of doc.attributes) {
      if (a instanceof Api.DocumentAttributeSticker || a instanceof Api.DocumentAttributeCustomEmoji) return undefined
      if (a instanceof Api.DocumentAttributeFilename) info.fileName = a.fileName
      else if (a instanceof Api.DocumentAttributeVideo) {
        info.w = a.w
        info.h = a.h
        info.duration = a.duration
      } else if (a instanceof Api.DocumentAttributeAudio) info.duration = a.duration
      else if (a instanceof Api.DocumentAttributeImageSize) {
        info.w = a.w
        info.h = a.h
      }
    }
    Object.assign(info, pickThumb(doc.thumbs))
    return info
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const photo = media.photo
    let size = 0
    let w = 0
    let h = 0
    for (const s of photo.sizes) {
      const bytes = s instanceof Api.PhotoSize ? s.size : s instanceof Api.PhotoSizeProgressive ? Math.max(...s.sizes) : 0
      if (bytes > size) {
        size = bytes
        w = (s as Api.PhotoSize).w
        h = (s as Api.PhotoSize).h
      }
    }
    return { kind: 'photo', id: photo.id.toString(), size, mime: 'image/jpeg', w, h, ...pickThumb(photo.sizes) }
  }
  return undefined
}

/** Converts a Telegram message to a stored entry, or null if TeleDriver ignores it. */
export function toEntry(chatKey: string, msg: Api.TypeMessage): Entry | null {
  if (!(msg instanceof Api.Message)) return null
  const text = msg.message ?? ''
  const parsed = parseTagged(text)
  const media = mediaInfo(msg.media)
  const base = {
    id: entryId(chatKey, msg.id),
    chatKey,
    msgId: msg.id,
    date: msg.date,
    editDate: msg.editDate ?? undefined,
    canEdit: !!msg.out && !msg.fwdFrom,
  }
  if (media) {
    const tagged = parsed.kind === 'file'
    return { ...base, kind: 'file', fields: tagged ? parsed.fields : {}, userText: tagged ? parsed.userText : text, media }
  }
  if (parsed.kind && parsed.kind !== 'file') return { ...base, kind: parsed.kind, fields: parsed.fields, userText: parsed.userText }
  return null
}
