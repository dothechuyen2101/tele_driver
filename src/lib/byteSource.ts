/** Something that can hand out bytes by offset: a Blob, a remote file, an encrypting view of either. */
export interface ByteSource {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export function blobSource(blob: Blob, start = 0, size = blob.size - start): ByteSource {
  return {
    size,
    read: async (offset, length) => new Uint8Array(await blob.slice(start + offset, start + Math.min(offset + length, size)).arrayBuffer()),
  }
}

export function subSource(source: ByteSource, start: number, size: number): ByteSource {
  return { size, read: (offset, length) => source.read(start + offset, Math.min(length, size - offset)) }
}

export interface BlockSourceOptions {
  blockSize?: number
  /** Blocks kept in memory; the uploader reads 512 KiB parts slightly out of order. */
  maxBlocks?: number
}

/**
 * Turns a remote "fetch bytes [start, end)" function into a ByteSource that
 * fetches large blocks once and serves many small reads from them. Concurrent
 * reads of the same block share one request.
 */
export function blockSource(
  size: number,
  fetchBlock: (start: number, end: number) => Promise<Uint8Array>,
  { blockSize = 8 * 1024 * 1024, maxBlocks = 4 }: BlockSourceOptions = {},
): ByteSource {
  const blocks = new Map<number, Promise<Uint8Array>>()
  const block = (index: number) => {
    let p = blocks.get(index)
    if (p) {
      // Refresh LRU position.
      blocks.delete(index)
      blocks.set(index, p)
      return p
    }
    const start = index * blockSize
    const end = Math.min(size, start + blockSize)
    p = fetchBlock(start, end).then((bytes) => {
      if (bytes.length !== end - start) throw new Error('SHORT_READ')
      return bytes
    })
    p.catch(() => blocks.delete(index))
    blocks.set(index, p)
    while (blocks.size > maxBlocks) blocks.delete(blocks.keys().next().value!)
    return p
  }
  return {
    size,
    async read(offset, length) {
      const end = Math.min(offset + length, size)
      const out = new Uint8Array(Math.max(0, end - offset))
      let pos = offset
      while (pos < end) {
        const index = Math.floor(pos / blockSize)
        const bytes = await block(index)
        const within = pos - index * blockSize
        const take = Math.min(bytes.length - within, end - pos)
        out.set(bytes.subarray(within, within + take), pos - offset)
        pos += take
      }
      return out
    },
  }
}
