import { Api } from 'teleproto'
import { generateRandomLong } from 'teleproto/Helpers'
import { requireStorage } from '@/stores/app'
import { getClient } from '@/telegram/client'
import { getMessage } from '@/telegram/download'
import { isRpc } from '@/telegram/errors'
import { inputPeer, type ChatTarget } from '@/telegram/peers'
import type { DriveFile } from './model'

export type ForwardMode = 'copy' | 'forward'

export function inputMediaOf(msg: Api.Message): Api.TypeInputMedia {
  const media = msg.media
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const d = media.document
    return new Api.InputMediaDocument({ id: new Api.InputDocument({ id: d.id, accessHash: d.accessHash, fileReference: d.fileReference }) })
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const p = media.photo
    return new Api.InputMediaPhoto({ id: new Api.InputPhoto({ id: p.id, accessHash: p.accessHash, fileReference: p.fileReference }) })
  }
  throw new Error('NO_MEDIA')
}

/**
 * `copy` re-sends the same Telegram file (no re-upload) as a new message with a
 * clean caption; `forward` is a regular forward that shows the source.
 */
export async function forwardFiles(files: DriveFile[], targets: ChatTarget[], mode: ForwardMode, cleanCaption: boolean, onProgress?: (done: number) => void) {
  const { ref } = requireStorage()
  const client = getClient()
  let done = 0
  for (const target of targets) {
    for (const file of files) {
      const ids = file.parts.map((p) => p.msgId)
      if (mode === 'forward') {
        await client.invoke(
          new Api.messages.ForwardMessages({
            fromPeer: inputPeer(ref),
            id: ids,
            toPeer: target.peer,
            randomId: ids.map(() => generateRandomLong()),
          }),
        )
      } else {
        for (const part of file.parts) {
          for (let attempt = 0; ; attempt++) {
            const msg = await getMessage(ref, part.msgId, attempt > 0)
            try {
              await client.invoke(
                new Api.messages.SendMedia({
                  peer: target.peer,
                  media: inputMediaOf(msg),
                  message: cleanCaption ? part.entry.userText : (msg.message ?? ''),
                  randomId: generateRandomLong(),
                }),
              )
              break
            } catch (err) {
              if (attempt === 0 && isRpc(err, 'FILE_REFERENCE_')) continue
              throw err
            }
          }
        }
      }
      onProgress?.(++done)
    }
  }
}
