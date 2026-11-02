import { describe, expect, it } from 'vitest'
import { composeText, mergeFields, parseFolderRef, parsePartIndex, parseTagged, serializeTag } from './metadata'

describe('metadata tags', () => {
  it('round-trips folder tags with unicode and spaces', () => {
    const text = serializeTag('dir', { p: 'root', n: 'Hợp đồng 2026 % final' })
    expect(text).toBe('#td_dir v=1 p=root n=Hợp%20đồng%202026%20%25%20final')
    const parsed = parseTagged(text)
    expect(parsed.kind).toBe('dir')
    expect(parsed.fields).toEqual({ v: '1', p: 'root', n: 'Hợp đồng 2026 % final' })
    expect(parsed.userText).toBe('')
  })

  it('keeps the user caption above the tag', () => {
    const text = composeText('Ghi chú\nnhiều dòng', 'file', { f: '12', n: 'a b.pdf' })
    const parsed = parseTagged(text)
    expect(parsed.kind).toBe('file')
    expect(parsed.userText).toBe('Ghi chú\nnhiều dòng')
    expect(parsed.fields.f).toBe('12')
    expect(parsed.fields.n).toBe('a b.pdf')
  })

  it('ignores text without a tag line', () => {
    const parsed = parseTagged('hello #td is not at line start\nplain')
    expect(parsed.kind).toBeNull()
    expect(parsed.userText).toBe('hello #td is not at line start\nplain')
  })

  it('does not confuse #td with #td_dir or other hashtags', () => {
    expect(parseTagged('#tdx f=1').kind).toBeNull()
    expect(parseTagged('#td f=1').kind).toBe('file')
    expect(parseTagged('#td_patch m=5 t=').fields).toEqual({ m: '5', t: '' })
  })

  it('tolerates malformed escapes', () => {
    expect(parseTagged('#td n=100%zz').fields.n).toBe('100%zz')
  })

  it('merges patches and clears empty fields', () => {
    expect(mergeFields({ f: '1', t: '99', n: 'x' }, { m: '7', v: '1', t: '', f: '3' })).toEqual({ f: '3', n: 'x' })
  })

  it('parses folder refs and part indexes', () => {
    expect(parseFolderRef('root')).toBe(0)
    expect(parseFolderRef(undefined)).toBe(0)
    expect(parseFolderRef('42')).toBe(42)
    expect(parseFolderRef('-3')).toBe(0)
    expect(parsePartIndex('2/5')).toEqual({ index: 2, count: 5 })
    expect(parsePartIndex('6/5')).toBeUndefined()
    expect(parsePartIndex('x')).toBeUndefined()
  })
})
