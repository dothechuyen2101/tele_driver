import { Api } from 'teleproto'
import { Raw } from 'teleproto/events'
import { db, entryId, type Entry } from '@/db/db'
import { useApp } from '@/stores/app'
import { getClient } from '@/telegram/client'
import { getHistoryPage, toEntry } from '@/telegram/messages'
import { chatKeyOf, isStoragePeer, type StorageRef } from '@/telegram/peers'
import { rememberMessage } from '@/telegram/download'

/** A full rescan also catches edits/deletes made elsewhere while we were offline. */
const FULL_SYNC_EVERY_MS = 6 * 60 * 60 * 1000

function setSync(patch: Partial<ReturnType<typeof useApp.getState>['sync']>) {
  useApp.setState((s) => ({ sync: { ...s.sync, ...patch } }))
}

let running: Promise<void> | null = null

export function syncStorage(ref: StorageRef, opts: { full?: boolean } = {}) {
  if (!running) {
    running = doSync(ref, opts).finally(() => {
      running = null
    })
  }
  return running
}

async function doSync(ref: StorageRef, opts: { full?: boolean }) {
  const chatKey = chatKeyOf(ref)
  const state = await db.syncState.get(chatKey)
  const full = opts.full || !state || Date.now() - state.lastFullSync > FULL_SYNC_EVERY_MS
  setSync({ running: true, scanned: 0, total: undefined, full, error: undefined })
  try {
    const seen = new Set<number>()
    let maxId = state?.maxId ?? 0
    let offsetId = 0
    let scanned = 0
    for (;;) {
      const { messages, count } = await getHistoryPage(ref, { offsetId, minId: full ? 0 : (state?.maxId ?? 0), limit: 100 })
      if (!messages.length) break
      const batch: Entry[] = []
      const drop: string[] = []
      for (const m of messages) {
        seen.add(m.id)
        maxId = Math.max(maxId, m.id)
        const e = toEntry(chatKey, m)
        if (e) {
          batch.push(e)
          if (m instanceof Api.Message) rememberMessage(ref, m)
        } else drop.push(entryId(chatKey, m.id))
      }
      await db.transaction('rw', db.entries, async () => {
        if (batch.length) await db.entries.bulkPut(batch)
        if (drop.length) await db.entries.bulkDelete(drop)
      })
      scanned += messages.length
      setSync({ scanned, total: count })
      offsetId = messages[messages.length - 1].id
      if (messages.length < 100 && !full) break
    }
    if (full) {
      // Anything we hold that the chat no longer has was deleted elsewhere.
      const stale = await db.entries.where('chatKey').equals(chatKey).filter((e) => !seen.has(e.msgId)).primaryKeys()
      if (stale.length) await db.entries.bulkDelete(stale)
    }
    await db.syncState.put({
      chatKey,
      maxId,
      lastFullSync: full ? Date.now() : (state?.lastFullSync ?? 0),
    })
    setSync({ running: false, lastSync: Date.now() })
  } catch (err) {
    setSync({ running: false, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Keeps the local index in step with changes made from other devices while the app is open. */
export function startLiveUpdates(ref: StorageRef, selfId: string) {
  const chatKey = chatKeyOf(ref)
  const client = getClient()
  const handler = async (update: unknown) => {
    try {
      if (
        update instanceof Api.UpdateNewMessage ||
        update instanceof Api.UpdateNewChannelMessage ||
        update instanceof Api.UpdateEditMessage ||
        update instanceof Api.UpdateEditChannelMessage
      ) {
        const msg = update.message
        if (!(msg instanceof Api.Message) || !isStoragePeer(ref, msg.peerId, selfId)) return
        rememberMessage(ref, msg)
        const e = toEntry(chatKey, msg)
        if (e) await db.entries.put(e)
        else await db.entries.delete(entryId(chatKey, msg.id))
        const st = await db.syncState.get(chatKey)
        if (st && msg.id > st.maxId) await db.syncState.put({ ...st, maxId: msg.id })
      } else if (update instanceof Api.UpdateDeleteMessages) {
        // Message ids of private chats and basic groups are unique per account.
        if (ref.kind === 'channel') return
        await db.entries.bulkDelete(update.messages.map((id) => entryId(chatKey, id)))
      } else if (update instanceof Api.UpdateDeleteChannelMessages) {
        if (ref.kind !== 'channel' || update.channelId.toString() !== ref.id) return
        await db.entries.bulkDelete(update.messages.map((id) => entryId(chatKey, id)))
      }
    } catch (err) {
      console.warn('live update failed', err)
    }
  }
  const event = new Raw({})
  client.addEventHandler(handler, event)
  return () => {
    try {
      client.removeEventHandler(handler, event)
    } catch {
      /* client already gone */
    }
  }
}

export async function putEntry(e: Entry | null) {
  if (e) await db.entries.put(e)
}
