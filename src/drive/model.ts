import type { Entry, MediaInfo } from '@/db/db'
import { categorize, guessMime, type Category } from '@/lib/mime'
import { mergeFields, parseFolderRef, parseIntField, parsePartIndex, type TagFields } from './metadata'

export interface DriveFolder {
  type: 'folder'
  key: string // `d:<msgId>`
  id: number
  parentId: number
  name: string
  /** Own flag; use `index.isEncryptedFolder` for the inherited value. */
  encrypted: boolean
  trashedAt?: number
  date: number
  entry: Entry
}

export interface FilePart {
  msgId: number
  index: number
  size: number
  entry: Entry
}

export interface EncInfo {
  wrappedKey: string
  nonce: string
  encName?: string
}

export interface DriveFile {
  type: 'file'
  key: string // `m:<msgId>` or `g:<splitId>`
  folderId: number
  name: string
  size: number
  mime: string
  category: Category
  date: number
  trashedAt?: number
  enc?: EncInfo
  /** True while the name of an encrypted file has not been decrypted yet. */
  locked: boolean
  parts: FilePart[]
  partCount: number
  complete: boolean
  userText: string
  media: MediaInfo
}

export type DriveItem = DriveFolder | DriveFile

export interface VaultRecord {
  msgId: number
  salt: string
  iterations: number
  wrapped: string
}

export interface DecryptedMeta {
  name: string
  mime: string
}

export interface DriveIndex {
  folders: Map<number, DriveFolder>
  files: Map<string, DriveFile>
  childFolders: Map<number, DriveFolder[]>
  childFiles: Map<number, DriveFile[]>
  /** Explicitly trashed items whose ancestors are not trashed. */
  trashed: DriveItem[]
  /** Patch entries keyed by the message id they target. */
  patches: Map<number, Entry[]>
  vault?: VaultRecord
  totalSize: number
  fileCount: number
}

export const EMPTY_INDEX: DriveIndex = {
  folders: new Map(),
  files: new Map(),
  childFolders: new Map(),
  childFiles: new Map(),
  trashed: [],
  patches: new Map(),
  totalSize: 0,
  fileCount: 0,
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function defaultName(entry: Entry) {
  const m = entry.media!
  if (m.fileName) return m.fileName
  const d = new Date(entry.date * 1000)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(
    d.getHours(),
  ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  if (m.kind === 'photo') return `photo_${stamp}.jpg`
  const ext = m.mime.split('/')[1]?.replace(/^x-/, '').split(/[;+]/)[0]
  return `file_${stamp}${ext && ext !== 'octet-stream' ? `.${ext}` : ''}`
}

export function buildIndex(entries: Entry[], decrypted: ReadonlyMap<string, DecryptedMeta> = new Map()): DriveIndex {
  const sorted = [...entries].sort((a, b) => a.msgId - b.msgId)
  const patches = new Map<number, Entry[]>()
  for (const e of sorted) {
    if (e.kind !== 'patch') continue
    const target = parseIntField(e.fields.m)
    if (target) push(patches, target, e)
  }
  const effective = (e: Entry): TagFields => {
    let f = e.fields
    for (const p of patches.get(e.msgId) ?? []) f = mergeFields(f, p.fields)
    return f
  }

  const index: DriveIndex = {
    folders: new Map(),
    files: new Map(),
    childFolders: new Map(),
    childFiles: new Map(),
    trashed: [],
    patches,
    totalSize: 0,
    fileCount: 0,
  }

  const groups = new Map<string, { fields: TagFields; entry: Entry }[]>()

  for (const e of sorted) {
    if (e.kind === 'dir') {
      const f = effective(e)
      index.folders.set(e.msgId, {
        type: 'folder',
        key: `d:${e.msgId}`,
        id: e.msgId,
        parentId: parseFolderRef(f.p),
        name: f.n || '?',
        encrypted: f.e === '1',
        trashedAt: parseIntField(f.t) || undefined,
        date: e.date,
        entry: e,
      })
    } else if (e.kind === 'vault' && !index.vault) {
      const f = effective(e)
      if (f.s && f.w) index.vault = { msgId: e.msgId, salt: f.s, iterations: parseIntField(f.it) ?? 600_000, wrapped: f.w }
    } else if (e.kind === 'file' && e.media) {
      const f = effective(e)
      if (f.g) push(groups, f.g, { fields: f, entry: e })
      else addFile(index, `m:${e.msgId}`, [{ fields: f, entry: e, index: 1 }], 1, decrypted)
    }
  }

  for (const [g, members] of groups) {
    const parts: { fields: TagFields; entry: Entry; index: number }[] = []
    let count = 0
    for (const m of members) {
      const pi = parsePartIndex(m.fields.i)
      if (!pi) continue
      count = Math.max(count, pi.count)
      // A re-uploaded duplicate part keeps the newest message.
      const existing = parts.findIndex((p) => p.index === pi.index)
      if (existing >= 0) parts[existing] = { ...m, index: pi.index }
      else parts.push({ ...m, index: pi.index })
    }
    if (parts.length) addFile(index, `g:${g}`, parts.sort((a, b) => a.index - b.index), count, decrypted)
  }

  // Resolve dangling or cyclic parents to root.
  for (const folder of index.folders.values()) {
    const seen = new Set<number>([folder.id])
    let p = folder.parentId
    while (p) {
      const parent = index.folders.get(p)
      if (!parent || seen.has(p)) {
        folder.parentId = 0
        break
      }
      seen.add(p)
      p = parent.parentId
    }
  }
  for (const folder of index.folders.values()) push(index.childFolders, folder.parentId, folder)
  for (const file of index.files.values()) {
    if (file.folderId && !index.folders.has(file.folderId)) file.folderId = 0
    push(index.childFiles, file.folderId, file)
  }

  const hiddenFolder = (id: number) => isFolderTrashed(index, id)
  for (const folder of index.folders.values()) {
    if (folder.trashedAt && !hiddenFolder(folder.parentId)) index.trashed.push(folder)
  }
  for (const file of index.files.values()) {
    if (hiddenFolder(file.folderId)) continue
    if (file.trashedAt) index.trashed.push(file)
    else {
      index.totalSize += file.size
      index.fileCount++
    }
  }
  return index
}

function addFile(
  index: DriveIndex,
  key: string,
  parts: { fields: TagFields; entry: Entry; index: number }[],
  partCount: number,
  decrypted: ReadonlyMap<string, DecryptedMeta>,
) {
  const head = parts[0]
  const f = head.fields
  const media = head.entry.media!
  const enc: EncInfo | undefined = f.e && f.x ? { wrappedKey: f.e, nonce: f.x, encName: f.en } : undefined
  const meta = enc?.encName ? decrypted.get(enc.encName) : undefined
  const name = enc ? (meta?.name ?? '') : f.n || defaultName(head.entry)
  const mime = enc ? (meta?.mime ?? 'application/octet-stream') : guessMime(name, media.mime)
  const streamSize = parts.reduce((n, p) => n + (p.entry.media?.size ?? 0), 0)
  const complete = parts.length === partCount && parts.every((p, i) => p.index === i + 1)
  index.files.set(key, {
    type: 'file',
    key,
    folderId: parseFolderRef(f.f),
    name,
    size: parseIntField(enc ? f.sz : f.ts) ?? streamSize,
    mime,
    category: categorize(mime, name),
    date: head.entry.date,
    trashedAt: parseIntField(f.t) || undefined,
    enc,
    locked: !!enc && !meta,
    parts: parts.map((p) => ({ msgId: p.entry.msgId, index: p.index, size: p.entry.media?.size ?? 0, entry: p.entry })),
    partCount,
    complete,
    userText: head.entry.userText,
    media,
  })
}

/** True if the folder or any of its ancestors is in the trash. */
export function isFolderTrashed(index: DriveIndex, id: number) {
  let cur = id
  for (let guard = 0; cur && guard < 1000; guard++) {
    const f = index.folders.get(cur)
    if (!f) return false
    if (f.trashedAt) return true
    cur = f.parentId
  }
  return false
}

export function isFolderEncrypted(index: DriveIndex, id: number) {
  let cur = id
  for (let guard = 0; cur && guard < 1000; guard++) {
    const f = index.folders.get(cur)
    if (!f) return false
    if (f.encrypted) return true
    cur = f.parentId
  }
  return false
}

export function folderPath(index: DriveIndex, id: number): DriveFolder[] {
  const path: DriveFolder[] = []
  let cur = id
  for (let guard = 0; cur && guard < 1000; guard++) {
    const f = index.folders.get(cur)
    if (!f) break
    path.unshift(f)
    cur = f.parentId
  }
  return path
}

export function isDescendant(index: DriveIndex, folderId: number, ancestorId: number) {
  let cur = folderId
  for (let guard = 0; cur && guard < 1000; guard++) {
    if (cur === ancestorId) return true
    cur = index.folders.get(cur)?.parentId ?? 0
  }
  return ancestorId === 0
}

/** All live (non-trashed) files, optionally below one folder. */
export function liveFiles(index: DriveIndex): DriveFile[] {
  const out: DriveFile[] = []
  for (const f of index.files.values()) if (!f.trashedAt && !isFolderTrashed(index, f.folderId)) out.push(f)
  return out
}

/** Every file and folder below `folderId`, with paths relative to it. */
export function collectTree(index: DriveIndex, folderId: number, prefix = ''): { files: { file: DriveFile; path: string }[]; folders: DriveFolder[] } {
  const files: { file: DriveFile; path: string }[] = []
  const folders: DriveFolder[] = []
  for (const file of index.childFiles.get(folderId) ?? []) if (!file.trashedAt) files.push({ file, path: prefix + file.name })
  for (const sub of index.childFolders.get(folderId) ?? []) {
    if (sub.trashedAt) continue
    folders.push(sub)
    const inner = collectTree(index, sub.id, `${prefix}${sub.name}/`)
    files.push(...inner.files)
    folders.push(...inner.folders)
  }
  return { files, folders }
}

/** Ids of every message that belongs to a folder subtree (folders + file parts + their patches). */
export function subtreeMessageIds(index: DriveIndex, folderId: number): number[] {
  const ids: number[] = [folderId]
  const walk = (id: number) => {
    for (const file of index.childFiles.get(id) ?? []) ids.push(...file.parts.map((p) => p.msgId))
    for (const sub of index.childFolders.get(id) ?? []) {
      ids.push(sub.id)
      walk(sub.id)
    }
  }
  walk(folderId)
  return ids
}
