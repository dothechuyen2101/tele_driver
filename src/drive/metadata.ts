/**
 * TeleDriver keeps its folder structure inside Telegram itself, as a single
 * tag line at the end of a message text or caption:
 *
 *   #td_dir v=1 p=root n=Work              folder (its id is the message id)
 *   #td v=1 f=1234 n=report.pdf            file inside folder 1234
 *   #td_patch v=1 m=5678 f=1234            override fields of message 5678
 *   #td_vault v=1 s=… it=600000 w=…         end-to-end encryption vault
 *
 * Values are percent-escaped only where needed (%, whitespace) so names stay
 * readable in the Telegram app.
 */
import type { EntryKind } from '@/db/db'

export type TagFields = Record<string, string>

export const TAG_VERSION = '1'

const PREFIX: Record<EntryKind, string> = {
  file: '#td',
  dir: '#td_dir',
  patch: '#td_patch',
  vault: '#td_vault',
}

const KIND_BY_PREFIX = new Map(Object.entries(PREFIX).map(([k, v]) => [v, k as EntryKind]))

export interface ParsedText {
  kind: EntryKind | null
  fields: TagFields
  userText: string
}

function escapeValue(v: string) {
  return v.replace(/[%\s]/g, (c) => encodeURIComponent(c))
}

function unescapeValue(v: string) {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export function serializeTag(kind: EntryKind, fields: TagFields) {
  const parts = [PREFIX[kind], `v=${TAG_VERSION}`]
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'v' || v === undefined) continue
    parts.push(`${k}=${escapeValue(v)}`)
  }
  return parts.join(' ')
}

export function parseTagged(text: string): ParsedText {
  const trimmed = text.replace(/\s+$/, '')
  const nl = trimmed.lastIndexOf('\n')
  const lastLine = trimmed.slice(nl + 1).trim()
  const tokens = lastLine.split(/ +/)
  const kind = KIND_BY_PREFIX.get(tokens[0])
  if (!kind) return { kind: null, fields: {}, userText: text }
  const fields: TagFields = {}
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=')
    if (eq <= 0) continue
    fields[token.slice(0, eq)] = unescapeValue(token.slice(eq + 1))
  }
  return { kind, fields, userText: nl >= 0 ? trimmed.slice(0, nl).replace(/\s+$/, '') : '' }
}

export function composeText(userText: string, kind: EntryKind, fields: TagFields) {
  const tag = serializeTag(kind, fields)
  return userText ? `${userText}\n${tag}` : tag
}

/** Applies a patch: a field with an empty value removes it. */
export function mergeFields(base: TagFields, patch: TagFields): TagFields {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'm' || k === 'v') continue
    if (v === '') delete out[k]
    else out[k] = v
  }
  return out
}

/** Folder references: `root` or a positive message id. 0 means root internally. */
export function parseFolderRef(v: string | undefined): number {
  if (!v || v === 'root') return 0
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

export function folderRef(id: number) {
  return id > 0 ? String(id) : 'root'
}

export function parseIntField(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** `i=2/5` → { index: 2, count: 5 } (1-based). */
export function parsePartIndex(v: string | undefined) {
  if (!v) return undefined
  const m = /^(\d+)\/(\d+)$/.exec(v)
  if (!m) return undefined
  const index = Number(m[1])
  const count = Number(m[2])
  if (index < 1 || count < 1 || index > count) return undefined
  return { index, count }
}

/** Telegram caps captions at 1024 characters (4096 with Premium). */
export const CAPTION_LIMIT = 1024
