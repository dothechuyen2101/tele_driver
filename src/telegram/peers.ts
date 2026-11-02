import bigInt from 'big-integer'
import { Api } from 'teleproto'
import { getClient } from './client'

export type StorageRef =
  | { kind: 'self'; title: string }
  | { kind: 'channel'; id: string; accessHash: string; title: string; broadcast: boolean }
  | { kind: 'chat'; id: string; title: string }

/** Any chat TeleDriver can read from: the storage kinds plus private chats (users, bots). */
export type PeerRef = StorageRef | { kind: 'user'; id: string; accessHash: string; title: string; username?: string }

export function chatKeyOf(ref: PeerRef) {
  if (ref.kind === 'self') return 'self'
  if (ref.kind === 'channel') return `c${ref.id}`
  if (ref.kind === 'user') return `u${ref.id}`
  return `g${ref.id}`
}

export function inputPeer(ref: PeerRef): Api.TypeInputPeer {
  if (ref.kind === 'self') return new Api.InputPeerSelf()
  if (ref.kind === 'channel') return new Api.InputPeerChannel({ channelId: bigInt(ref.id), accessHash: bigInt(ref.accessHash) })
  if (ref.kind === 'user') return new Api.InputPeerUser({ userId: bigInt(ref.id), accessHash: bigInt(ref.accessHash) })
  return new Api.InputPeerChat({ chatId: bigInt(ref.id) })
}

/** Rebuilds a peer from a chat key (and access hash) stored in a `#td_sub` record. */
export function peerFromKey(key: string, accessHash: string, title: string): PeerRef | undefined {
  if (key === 'self') return { kind: 'self', title }
  const id = key.slice(1)
  if (!/^\d+$/.test(id)) return undefined
  if (key[0] === 'c') return { kind: 'channel', id, accessHash, title, broadcast: true }
  if (key[0] === 'u') return { kind: 'user', id, accessHash, title }
  if (key[0] === 'g') return { kind: 'chat', id, title }
  return undefined
}

export function accessHashOf(ref: PeerRef) {
  return ref.kind === 'channel' || ref.kind === 'user' ? ref.accessHash : ''
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

export function refFromEntity(entity: Api.Channel | Api.Chat): StorageRef
export function refFromEntity(entity: Api.Channel | Api.Chat | Api.User): PeerRef
export function refFromEntity(entity: Api.Channel | Api.Chat | Api.User): PeerRef {
  if (entity instanceof Api.User) {
    if (entity.self) return { kind: 'self', title: 'Saved Messages' }
    return {
      kind: 'user',
      id: entity.id.toString(),
      accessHash: (entity.accessHash ?? bigInt.zero).toString(),
      title: [entity.firstName, entity.lastName].filter(Boolean).join(' ') || entity.username || '?',
      username: entity.username ?? undefined,
    }
  }
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

export interface SourceChat {
  ref: PeerRef
  kind: 'self' | 'user' | 'bot' | 'group' | 'channel'
  username?: string
  /** "Restrict saving content" is on: Telegram forbids copying from it. */
  protected: boolean
}

function sourceOf(e: Api.Channel | Api.Chat | Api.User): SourceChat {
  if (e instanceof Api.User) {
    return { ref: refFromEntity(e), kind: e.self ? 'self' : e.bot ? 'bot' : 'user', username: e.username ?? undefined, protected: false }
  }
  return {
    ref: refFromEntity(e),
    kind: e instanceof Api.Channel && e.broadcast ? 'channel' : 'group',
    username: e instanceof Api.Channel ? (e.username ?? undefined) : undefined,
    protected: !!e.noforwards,
  }
}

/** Every chat that files can be imported from. */
export async function listSourceChats(): Promise<SourceChat[]> {
  const dialogs = await getClient().getDialogs({ limit: 400 })
  const out: SourceChat[] = []
  for (const d of dialogs) {
    const e = d.entity
    if (e instanceof Api.User && !e.deleted) out.push(sourceOf(e))
    else if (e instanceof Api.Channel || (e instanceof Api.Chat && !e.deactivated && !e.left)) out.push(sourceOf(e))
  }
  return out
}

export type PeerLink = { type: 'username'; username: string } | { type: 'channelId'; id: string } | { type: 'invite'; hash: string }

const USERNAME = /^[a-z][a-z0-9_]{3,}$/i

/** Understands @name, name, t.me/name(/123), t.me/s/name, t.me/c/<id>/<msg>, t.me/+hash and joinchat links. */
export function parsePeerLink(input: string): PeerLink | undefined {
  const s = input.trim()
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t(?:elegram)?\.me|telegram\.dog)\/(.+)$/i.exec(s)
  if (m) {
    const path = m[1].split(/[?#]/)[0].split('/').filter(Boolean)
    if (!path.length) return undefined
    if (path[0] === 'c' && /^\d+$/.test(path[1] ?? '')) return { type: 'channelId', id: path[1] }
    if (path[0] === 'joinchat' && path[1]) return { type: 'invite', hash: path[1] }
    if (path[0].startsWith('+') && path[0].length > 1) return { type: 'invite', hash: path[0].slice(1) }
    if (path[0] === 's' && path[1]) return USERNAME.test(path[1]) ? { type: 'username', username: path[1] } : undefined
    return USERNAME.test(path[0]) ? { type: 'username', username: path[0] } : undefined
  }
  const name = s.replace(/^@/, '')
  return USERNAME.test(name) ? { type: 'username', username: name } : undefined
}

/** Resolves a pasted link or @username to a chat the account can read. */
export async function resolvePeerLink(input: string): Promise<SourceChat> {
  const link = parsePeerLink(input)
  if (!link) throw new Error('BAD_LINK')
  if (link.type === 'invite') {
    const res = await getClient().invoke(new Api.messages.CheckChatInvite({ hash: link.hash }))
    if (res instanceof Api.ChatInviteAlready && (res.chat instanceof Api.Channel || res.chat instanceof Api.Chat)) return sourceOf(res.chat)
    throw new Error('JOIN_FIRST')
  }
  if (link.type === 'channelId') {
    const found = (await listSourceChats()).find((c) => c.ref.kind === 'channel' && c.ref.id === link.id)
    if (!found) throw new Error('JOIN_FIRST')
    return found
  }
  const res = await getClient().invoke(new Api.contacts.ResolveUsername({ username: link.username }))
  const e = [...res.chats, ...res.users].find(
    (x): x is Api.Channel | Api.Chat | Api.User => x instanceof Api.Channel || x instanceof Api.Chat || x instanceof Api.User,
  )
  if (!e) throw new Error('USERNAME_NOT_OCCUPIED')
  return sourceOf(e)
}
