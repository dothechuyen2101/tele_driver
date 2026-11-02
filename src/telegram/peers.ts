import bigInt from 'big-integer'
import { Api } from 'teleproto'
import { getClient } from './client'

export type StorageRef =
  | { kind: 'self'; title: string }
  | { kind: 'channel'; id: string; accessHash: string; title: string; broadcast: boolean }
  | { kind: 'chat'; id: string; title: string }

export function chatKeyOf(ref: StorageRef) {
  if (ref.kind === 'self') return 'self'
  if (ref.kind === 'channel') return `c${ref.id}`
  return `g${ref.id}`
}

export function inputPeer(ref: StorageRef): Api.TypeInputPeer {
  if (ref.kind === 'self') return new Api.InputPeerSelf()
  if (ref.kind === 'channel') return new Api.InputPeerChannel({ channelId: bigInt(ref.id), accessHash: bigInt(ref.accessHash) })
  return new Api.InputPeerChat({ chatId: bigInt(ref.id) })
}

export function inputChannel(ref: Extract<StorageRef, { kind: 'channel' }>) {
  return new Api.InputChannel({ channelId: bigInt(ref.id), accessHash: bigInt(ref.accessHash) })
}

/** Whether a message's peer is the storage chat. */
export function isStoragePeer(ref: StorageRef, peer: Api.TypePeer | undefined, selfId: string) {
  if (!peer) return false
  if (ref.kind === 'self') return peer instanceof Api.PeerUser && peer.userId.toString() === selfId
  if (ref.kind === 'channel') return peer instanceof Api.PeerChannel && peer.channelId.toString() === ref.id
  return peer instanceof Api.PeerChat && peer.chatId.toString() === ref.id
}

function canPostMedia(entity: Api.Channel | Api.Chat) {
  if (entity instanceof Api.Chat) return !entity.deactivated && !entity.left && !entity.defaultBannedRights?.sendMedia
  if (entity.left) return false
  if (entity.broadcast) return !!entity.creator || !!entity.adminRights?.postMessages
  if (entity.monoforum) return false
  return !!entity.creator || !!entity.adminRights || (!entity.bannedRights?.sendMedia && !entity.defaultBannedRights?.sendMedia)
}

export function refFromEntity(entity: Api.Channel | Api.Chat): StorageRef {
  if (entity instanceof Api.Channel) {
    return {
      kind: 'channel',
      id: entity.id.toString(),
      accessHash: (entity.accessHash ?? bigInt.zero).toString(),
      title: entity.title,
      broadcast: !!entity.broadcast,
    }
  }
  return { kind: 'chat', id: entity.id.toString(), title: entity.title }
}

export interface StorageOption {
  ref: StorageRef
  kind: 'channel' | 'group'
  members?: number
}

/** Channels and groups where the user can post files. */
export async function listStorageOptions(): Promise<StorageOption[]> {
  const dialogs = await getClient().getDialogs({ limit: 400 })
  const out: StorageOption[] = []
  for (const d of dialogs) {
    const e = d.entity
    if (!(e instanceof Api.Channel) && !(e instanceof Api.Chat)) continue
    if (e instanceof Api.Channel && e.forum) continue
    if (!canPostMedia(e)) continue
    out.push({
      ref: refFromEntity(e),
      kind: e instanceof Api.Channel && e.broadcast ? 'channel' : 'group',
      members: e.participantsCount ?? undefined,
    })
  }
  return out
}

export async function createStorageChannel(title: string, about: string): Promise<StorageRef> {
  const result = await getClient().invoke(new Api.channels.CreateChannel({ title, about, broadcast: true }))
  const chats = 'chats' in result ? result.chats : []
  const channel = chats.find((c): c is Api.Channel => c instanceof Api.Channel)
  if (!channel) throw new Error('Channel creation returned no channel')
  return refFromEntity(channel)
}

export interface ChatTarget {
  key: string
  title: string
  kind: 'self' | 'user' | 'bot' | 'group' | 'channel'
  peer: Api.TypeInputPeer
  username?: string
}

/** Chats the user can send to, for the forward dialog. */
export async function listChatTargets(): Promise<ChatTarget[]> {
  const dialogs = await getClient().getDialogs({ limit: 300 })
  const out: ChatTarget[] = []
  for (const d of dialogs) {
    const e = d.entity
    if (e instanceof Api.User) {
      if (e.deleted) continue
      out.push({
        key: `u${e.id}`,
        title: e.self ? 'Saved Messages' : [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || '?',
        kind: e.self ? 'self' : e.bot ? 'bot' : 'user',
        peer: d.inputEntity,
        username: e.username ?? undefined,
      })
    } else if (e instanceof Api.Channel || e instanceof Api.Chat) {
      if (!canPostMedia(e)) continue
      out.push({
        key: e instanceof Api.Channel ? `c${e.id}` : `g${e.id}`,
        title: e.title,
        kind: e instanceof Api.Channel && e.broadcast ? 'channel' : 'group',
        peer: d.inputEntity,
        username: e instanceof Api.Channel ? (e.username ?? undefined) : undefined,
      })
    }
  }
  return out
}
