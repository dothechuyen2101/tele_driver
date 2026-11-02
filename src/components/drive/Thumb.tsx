import { useEffect, useMemo, useState } from 'react'
import { db } from '@/db/db'
import { thumbKey } from '@/lib/thumbs'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { loadThumb, strippedToDataUrl } from '@/telegram/download'
import { chatKeyOf } from '@/telegram/peers'
import type { DriveFile } from '@/drive/model'

/**
 * Progressive thumbnail: Telegram's inline "stripped" preview (blurred) shows
 * instantly, then the real ~320px thumbnail from cache or the network.
 */
function useThumbnail(file: DriveFile) {
  const storage = useApp((s) => s.storage)
  const [url, setUrl] = useState<string>()
  const stripped = useMemo(() => {
    if (!file.media.stripped || file.enc) return undefined
    try {
      return strippedToDataUrl(file.media.stripped)
    } catch {
      return undefined
    }
  }, [file.media.stripped, file.enc])

  const msgId = file.parts[0]?.msgId
  const thumbType = file.enc ? undefined : file.media.thumbType
  useEffect(() => {
    if (!storage || !msgId) return
    let alive = true
    let objectUrl: string | undefined
    const key = thumbKey(chatKeyOf(storage), file.key)
    const show = (blob: Blob | undefined) => {
      if (!alive || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }
    void (async () => {
      const cached = await db.thumbs.get(key)
      if (cached) return show(cached.blob)
      if (thumbType) show(await loadThumb(storage, msgId, thumbType, key).catch(() => undefined))
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(undefined)
    }
  }, [storage, msgId, thumbType, file.key])

  return { url, stripped }
}

export function ThumbImage({ file, className, fallback }: { file: DriveFile; className?: string; fallback: React.ReactNode }) {
  const { url, stripped } = useThumbnail(file)
  if (!url && !stripped) return <>{fallback}</>
  return (
    <div className={cn('relative size-full overflow-hidden', className)}>
      {stripped && !url && <img src={stripped} alt="" className="blur-thumb size-full object-cover" draggable={false} />}
      {url && <img src={url} alt="" className="size-full object-cover" draggable={false} loading="lazy" />}
    </div>
  )
}
