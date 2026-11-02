import { Api } from 'teleproto'
import { db } from '@/db/db'
import { fromBase64Url } from '@/lib/bytes'
import { getClient } from './client'
import { isRpc } from './errors'
import { fetchMessages } from './messages'
import type { StorageRef } from './peers'
import { chatKeyOf } from './peers'
import { strippedPhotoToJpg } from 'teleproto/Utils'
import { Buffer } from 'teleproto/platform/index'

const MB = 1024 * 1024
const cache = new Map<string, Api.Message>()

/** Message objects carry the file reference needed to download; cached and refreshed on demand. */
export async function getMessage(ref: StorageRef, msgId: number, refresh = false): Promise<Api.Message> {
  const key = `${chatKeyOf(ref)}:${msgId}`
  if (!refresh) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const msg = (await fetchMessages(ref, [msgId])).get(msgId)
  if (!msg) throw new Error('FILE_GONE')
  cache.set(key, msg)
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return msg
}

export function rememberMessage(ref: StorageRef, msg: Api.Message) {
  cache.set(`${chatKeyOf(ref)}:${msg.id}`, msg)
}

/**
 * Streams bytes [offset, offset + length) of the media in a message. Telegram
 * downloads in aligned 1 MiB blocks; the extra bytes are trimmed here.
 */
export async function* readMessageRange(ref: StorageRef, msgId: number, offset: number, length: number, signal?: AbortSignal) {
  const end = offset + length
  let pos = offset
  for (let attempt = 0; pos < end; attempt++) {
    const msg = await getMessage(ref, msgId, attempt > 0)
    try {
      for await (const chunk of getClient().iterDownload(msg, { offset: pos, limit: end - pos, requestSize: MB, signal })) {
        const take = Math.min(chunk.length, end - pos)
        if (take <= 0) break
        yield new Uint8Array(chunk.buffer, chunk.byteOffset, take)
        pos += take
        if (pos >= end) return
      }
      return
    } catch (err) {
      if (attempt < 2 && isRpc(err, 'FILE_REFERENCE_')) continue
      throw err
    }
  }
}

const thumbQueue: (() => void)[] = []
let thumbActive = 0

async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbActive >= 4) await new Promise<void>((r) => thumbQueue.push(r))
  thumbActive++
  try {
    return await fn()
  } finally {
    thumbActive--
    thumbQueue.shift()?.()
  }
}

function findSize(msg: Api.Message, type: string): Api.TypePhotoSize | undefined {
  const media = msg.media
  const sizes =
    media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document
      ? media.document.thumbs
      : media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo
        ? media.photo.sizes
        : undefined
  return sizes?.find((s) => 'type' in s && s.type === type)
}

/** Downloads (and caches in IndexedDB) the small preview image of a message. */
export async function loadThumb(ref: StorageRef, msgId: number, thumbType: string, cacheKey: string): Promise<Blob | undefined> {
  const cached = await db.thumbs.get(cacheKey)
  if (cached) return cached.blob
  return withThumbSlot(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const msg = await getMessage(ref, msgId, attempt > 0)
      const size = findSize(msg, thumbType)
      if (!size) return undefined
      try {
        const data = await getClient().downloadMedia(msg, { thumb: size })
        if (!data || typeof data === 'string') return undefined
        const blob = new Blob([new Uint8Array(data)], { type: 'image/jpeg' })
        await db.thumbs.put({ id: cacheKey, blob, at: Date.now() })
        return blob
      } catch (err) {
        if (attempt === 0 && isRpc(err, 'FILE_REFERENCE_')) continue
        throw err
      }
    }
  })
}

/** Inflates Telegram's ~1 KB "stripped" thumbnail into a displayable JPEG data URL. */
export function strippedToDataUrl(stripped: string) {
  const jpg = strippedPhotoToJpg(Buffer.from(fromBase64Url(stripped)))
  let bin = ''
  for (let i = 0; i < jpg.length; i++) bin += String.fromCharCode(jpg[i])
  return `data:image/jpeg;base64,${btoa(bin)}`
}
