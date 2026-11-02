/** Upload part size used by Telegram (512 KiB); a file may have up to 4000 (8000 with Premium) parts. */
export const TG_PART = 512 * 1024

/** Max bytes per Telegram document given the account's part limit. Always a multiple of 1 MiB. */
export function maxDocumentBytes(maxParts: number) {
  return maxParts * TG_PART
}

export interface Span {
  offset: number
  size: number
}

/** Splits a byte stream into consecutive pieces of at most `partMax` bytes. */
export function splitPlan(streamSize: number, partMax: number): Span[] {
  if (streamSize <= partMax) return [{ offset: 0, size: streamSize }]
  const spans: Span[] = []
  for (let offset = 0; offset < streamSize; offset += partMax) spans.push({ offset, size: Math.min(partMax, streamSize - offset) })
  return spans
}

export interface PartSlice {
  part: number
  offset: number
  length: number
}

/** Maps the stream range [start, end) onto per-part slices, given each part's size in order. */
export function mapRange(partSizes: number[], start: number, end: number): PartSlice[] {
  const out: PartSlice[] = []
  let base = 0
  for (let part = 0; part < partSizes.length && base < end; part++) {
    const size = partSizes[part]
    const from = Math.max(start, base)
    const to = Math.min(end, base + size)
    if (to > from) out.push({ part, offset: from - base, length: to - from })
    base += size
  }
  return out
}

export function splitPartName(name: string, index: number, count: number) {
  const width = Math.max(3, String(count).length)
  return `${name}.${String(index).padStart(width, '0')}`
}
