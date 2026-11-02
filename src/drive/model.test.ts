import { describe, expect, it } from 'vitest'
import type { Entry } from '@/db/db'
import { buildIndex, collectTree, folderPath, isFolderEncrypted } from './model'

let date = 1_700_000_000

function dir(msgId: number, fields: Record<string, string>): Entry {
  return { id: `self:${msgId}`, chatKey: 'self', msgId, kind: 'dir', date: date++, fields, userText: '', canEdit: true }
}

function file(msgId: number, fields: Record<string, string>, size = 100, fileName = `f${msgId}.txt`): Entry {
  return {
    id: `self:${msgId}`,
    chatKey: 'self',
    msgId,
    kind: 'file',
    date: date++,
    fields,
    userText: '',
    canEdit: true,
    media: { kind: 'document', id: String(msgId), size, mime: 'text/plain', fileName },
  }
}

function patch(msgId: number, fields: Record<string, string>): Entry {
  return { id: `self:${msgId}`, chatKey: 'self', msgId, kind: 'patch', date: date++, fields, userText: '', canEdit: true }
}

describe('buildIndex', () => {
  it('builds a folder tree and places files', () => {
    const idx = buildIndex([dir(1, { p: 'root', n: 'Work' }), dir(2, { p: '1', n: 'Docs' }), file(3, { f: '2' }), file(4, {})])
    expect(idx.childFolders.get(0)?.map((f) => f.name)).toEqual(['Work'])
    expect(idx.childFolders.get(1)?.map((f) => f.name)).toEqual(['Docs'])
    expect(idx.childFiles.get(2)?.map((f) => f.name)).toEqual(['f3.txt'])
    expect(idx.childFiles.get(0)?.map((f) => f.key)).toEqual(['m:4'])
    expect(folderPath(idx, 2).map((f) => f.name)).toEqual(['Work', 'Docs'])
    expect(idx.fileCount).toBe(2)
  })

  it('applies patches in message order', () => {
    const idx = buildIndex([dir(1, { n: 'A' }), file(2, { f: 'root' }), patch(3, { m: '2', f: '1' }), patch(4, { m: '1', n: 'B' })])
    expect(idx.files.get('m:2')?.folderId).toBe(1)
    expect(idx.folders.get(1)?.name).toBe('B')
  })

  it('moves files of missing folders to root and breaks cycles', () => {
    const idx = buildIndex([dir(1, { p: '2', n: 'X' }), dir(2, { p: '1', n: 'Y' }), file(3, { f: '99' })])
    expect(idx.files.get('m:3')?.folderId).toBe(0)
    const roots = idx.childFolders.get(0) ?? []
    expect(roots.length).toBeGreaterThan(0)
  })

  it('hides children of trashed folders and lists only the top trashed item', () => {
    const idx = buildIndex([dir(1, { n: 'Old', t: '1700000000' }), file(2, { f: '1' }), dir(3, { p: '1', n: 'Inner' }), file(4, { t: '1700000001' })])
    expect(idx.trashed.map((i) => i.key).sort()).toEqual(['d:1', 'm:4'])
    expect(idx.fileCount).toBe(0)
    expect(collectTree(idx, 1).files.length).toBe(1)
  })

  it('groups split parts into one logical file', () => {
    const idx = buildIndex([
      file(10, { g: 'abc', i: '2/3', n: 'movie.mkv', ts: '250' }, 100, 'movie.mkv.002'),
      file(11, { g: 'abc', i: '1/3', n: 'movie.mkv', ts: '250' }, 100, 'movie.mkv.001'),
      file(12, { g: 'abc', i: '3/3', n: 'movie.mkv', ts: '250' }, 50, 'movie.mkv.003'),
    ])
    const f = idx.files.get('g:abc')!
    expect(f.name).toBe('movie.mkv')
    expect(f.size).toBe(250)
    expect(f.parts.map((p) => p.msgId)).toEqual([11, 10, 12])
    expect(f.complete).toBe(true)
    expect(f.category).toBe('video')
  })

  it('marks incomplete split files', () => {
    const idx = buildIndex([file(10, { g: 'z', i: '1/2', n: 'a.zip' }), file(12, { g: 'z', i: '3/3', n: 'a.zip' })])
    expect(idx.files.get('g:z')?.complete).toBe(false)
  })

  it('inherits encrypted folders and reads the vault', () => {
    const idx = buildIndex([
      dir(1, { n: 'Secret', e: '1' }),
      dir(2, { p: '1', n: 'Sub' }),
      { id: 'self:3', chatKey: 'self', msgId: 3, kind: 'vault', date: 1, fields: { s: 'salt', it: '1000', w: 'wrap' }, userText: '', canEdit: true },
      file(4, { f: '2', e: 'wk', x: 'nonce', en: 'encname', sz: '42' }, 58, 'x.bin'),
    ])
    expect(isFolderEncrypted(idx, 2)).toBe(true)
    expect(idx.vault).toEqual({ msgId: 3, salt: 'salt', iterations: 1000, wrapped: 'wrap' })
    const f = idx.files.get('m:4')!
    expect(f.locked).toBe(true)
    expect(f.size).toBe(42)
    const unlocked = buildIndex([file(4, { e: 'wk', x: 'n', en: 'encname', sz: '42' })], new Map([['encname', { name: 'a.pdf', mime: 'application/pdf' }]]))
    expect(unlocked.files.get('m:4')).toMatchObject({ name: 'a.pdf', locked: false, category: 'document' })
  })
})

describe('imports', () => {
  it('records import origins, including trashed files', () => {
    const idx = buildIndex([file(1, { s: 'tg:c5:10' }), file(2, { s: 'gd:abc', t: '1700000000' }), file(3, {})])
    expect(idx.sources.get('tg:c5:10')).toBe('m:1')
    expect(idx.sources.get('gd:abc')).toBe('m:2')
    expect(idx.sources.size).toBe(2)
  })

  it('reads followed sources and their patches', () => {
    const sub: Entry = {
      id: 'self:7', chatKey: 'self', msgId: 7, kind: 'sub', date: 1, userText: '', canEdit: false,
      fields: { c: 'c123', h: '999', n: 'News', f: '4', k: 'dv', l: '50', a: '1' },
    }
    const idx = buildIndex([sub, patch(8, { m: '7', l: '75', t: '1700000000' })])
    expect(idx.subs).toEqual([
      expect.objectContaining({ msgId: 7, source: 'c123', accessHash: '999', title: 'News', folderId: 4, kinds: 'dv', last: 75, auto: true, paused: false, lastRun: 1700000000 }),
    ])
  })
})
