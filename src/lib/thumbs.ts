export interface MediaProbe {
  kind: 'image' | 'video' | 'audio' | 'other'
  w?: number
  h?: number
  duration?: number
  /** JPEG, at most 320px on the long side (Telegram's thumbnail limit). */
  thumb?: Blob
}

const THUMB_MAX = 320

function canvasToJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(undefined)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.82))
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

async function probeImage(file: Blob): Promise<MediaProbe> {
  if (file.size > 60 * 1024 * 1024) return { kind: 'image' }
  try {
    const bmp = await createImageBitmap(file)
    const thumb = await canvasToJpeg(bmp, bmp.width, bmp.height)
    const out = { kind: 'image' as const, w: bmp.width, h: bmp.height, thumb }
    bmp.close()
    return out
  } catch {
    return { kind: 'image' }
  }
}

function probeVideo(file: Blob): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    const done = (r: MediaProbe) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(r)
    }
    video.onerror = () => done({ kind: 'video' })
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : undefined
      video.currentTime = Math.min(1, (duration ?? 0) / 3)
      video.onseeked = async () => {
        const thumb = video.videoWidth ? await canvasToJpeg(video, video.videoWidth, video.videoHeight) : undefined
        done({ kind: 'video', w: video.videoWidth, h: video.videoHeight, duration, thumb })
      }
    }
    video.src = url
  })
}

function probeAudio(file: Blob): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    const done = (r: MediaProbe) => {
      URL.revokeObjectURL(url)
      resolve(r)
    }
    audio.onerror = () => done({ kind: 'audio' })
    audio.onloadedmetadata = () => done({ kind: 'audio', duration: Number.isFinite(audio.duration) ? audio.duration : undefined })
    audio.src = url
  })
}

/** Reads dimensions/duration and renders a thumbnail where the browser can decode the file. */
export function probeMedia(file: Blob, mime: string): Promise<MediaProbe> {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return withTimeout(probeImage(file), 10_000, { kind: 'image' })
  if (mime.startsWith('video/')) return withTimeout(probeVideo(file), 10_000, { kind: 'video' })
  if (mime.startsWith('audio/')) return withTimeout(probeAudio(file), 8_000, { kind: 'audio' })
  return Promise.resolve({ kind: 'other' })
}

export const thumbKey = (chatKey: string, fileKey: string) => `${chatKey}:${fileKey}`
