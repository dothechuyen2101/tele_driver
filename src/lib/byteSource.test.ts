import { describe, expect, it } from 'vitest'
import { blockSource, subSource } from './byteSource'

const byte = (i: number) => (i * 13 + (i >> 9)) & 0xff

function remote() {
  const calls: [number, number][] = []
  const fetchBlock = async (start: number, end: number) => {
    calls.push([start, end])
    await new Promise((r) => setTimeout(r, 1))
    const out = new Uint8Array(end - start)
    for (let i = 0; i < out.length; i++) out[i] = byte(start + i)
    return out
  }
  return { calls, fetchBlock }
}

describe('blockSource', () => {
  it('serves exact bytes across block boundaries', async () => {
    const { fetchBlock } = remote()
    const src = blockSource(10_000, fetchBlock, { blockSize: 1024, maxBlocks: 2 })
    const out = await src.read(1000, 3000)
    expect(out.length).toBe(3000)
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(byte(1000 + i))
    expect((await src.read(9_990, 100)).length).toBe(10)
  })

  it('shares one request for concurrent reads of a block', async () => {
    const { calls, fetchBlock } = remote()
    const src = blockSource(8192, fetchBlock, { blockSize: 4096 })
    await Promise.all([src.read(0, 512), src.read(512, 512), src.read(1024, 512), src.read(4096, 512)])
    expect(calls).toEqual([
      [0, 4096],
      [4096, 8192],
    ])
  })

  it('rejects short remote reads instead of corrupting data', async () => {
    const src = blockSource(100, async () => new Uint8Array(10), { blockSize: 64 })
    await expect(src.read(0, 10)).rejects.toThrow('SHORT_READ')
  })

  it('composes with subSource for split parts', async () => {
    const { fetchBlock } = remote()
    const part = subSource(blockSource(5000, fetchBlock, { blockSize: 700 }), 2000, 1500)
    const out = await part.read(1400, 512)
    expect(out.length).toBe(100)
    expect(out[0]).toBe(byte(3400))
  })
})
