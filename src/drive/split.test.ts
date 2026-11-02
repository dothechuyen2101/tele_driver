import { describe, expect, it } from 'vitest'
import { mapRange, maxDocumentBytes, splitPartName, splitPlan } from './split'
import { CIPHER_CHUNK } from '@/crypto/chunkCipher'

describe('split', () => {
  it('limits match Telegram (2000 MiB / 4000 MiB) and align to cipher chunks', () => {
    expect(maxDocumentBytes(4000)).toBe(2000 * 1024 * 1024)
    expect(maxDocumentBytes(8000)).toBe(4000 * 1024 * 1024)
    expect(maxDocumentBytes(4000) % CIPHER_CHUNK).toBe(0)
  })

  it('plans parts', () => {
    expect(splitPlan(10, 10)).toEqual([{ offset: 0, size: 10 }])
    expect(splitPlan(25, 10)).toEqual([
      { offset: 0, size: 10 },
      { offset: 10, size: 10 },
      { offset: 20, size: 5 },
    ])
  })

  it('maps ranges across parts', () => {
    expect(mapRange([10, 10, 5], 0, 25)).toEqual([
      { part: 0, offset: 0, length: 10 },
      { part: 1, offset: 0, length: 10 },
      { part: 2, offset: 0, length: 5 },
    ])
    expect(mapRange([10, 10, 5], 8, 12)).toEqual([
      { part: 0, offset: 8, length: 2 },
      { part: 1, offset: 0, length: 2 },
    ])
    expect(mapRange([10, 10, 5], 21, 22)).toEqual([{ part: 2, offset: 1, length: 1 }])
  })

  it('names parts', () => {
    expect(splitPartName('a.mkv', 2, 3)).toBe('a.mkv.002')
  })
})
