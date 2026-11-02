import { useEffect, useState } from 'react'
import { Dialog as D } from 'radix-ui'
import { ChevronLeft, ChevronRight, Download, Info, Send, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { downloadItems } from '@/app/actions'
import { asReadableStream, readFileBlob, readFileRange } from '@/drive/logical'
import type { DriveFile } from '@/drive/model'
import { formatBytes, formatDate } from '@/lib/format'
import { previewKind, type PreviewKind } from '@/lib/mime'
import { registerStream, streamingAvailable, unregisterStream } from '@/lib/streamBridge'
import { describeError } from '@/lib/uiErrors'
import { useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { Button } from '../ui/button'
import { Progress, Spinner, Tip } from '../ui/misc'
import { FileIcon } from './FileIcon'

const LIMITS: Partial<Record<PreviewKind, number>> = {
  image: 60 * 1024 * 1024,
  pdf: 300 * 1024 * 1024,
  text: 2 * 1024 * 1024,
}
/** Media is streamed when possible; this is the in-memory fallback cap. */
const MEDIA_BLOB_LIMIT = 300 * 1024 * 1024

/** MIME types that are safe to hand to the browser for each preview kind. */
function safeType(kind: PreviewKind, mime: string) {
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'image') return mime.startsWith('image/') && mime !== 'image/svg+xml' ? mime : 'image/png'
  return mime
}

type State = { status: 'loading'; progress: number } | { status: 'ready'; url?: string; text?: string } | { status: 'error'; message: string } | { status: 'unsupported' }

function useSource(file: DriveFile, kind: PreviewKind) {
  const [state, setState] = useState<State>({ status: 'loading', progress: 0 })
  useEffect(() => {
    const ac = new AbortController()
    let objectUrl: string | undefined
    let token: string | undefined
    void (async () => {
      try {
        if (!file.complete) throw new Error('FILE_INCOMPLETE')
        if (kind === 'video' || kind === 'audio') {
          if (streamingAvailable()) {
            const reg = await registerStream({
              name: file.name,
              mime: safeType(kind, file.mime),
              size: file.size,
              attachment: false,
              open: (start, end, signal) => readFileRange(file, start, end ?? file.size, signal),
            })
            token = reg.token
            if (!ac.signal.aborted) setState({ status: 'ready', url: reg.url })
            return
          }
          if (file.size > MEDIA_BLOB_LIMIT) throw new Error('SW_REQUIRED')
        } else if (kind === 'none' || file.size > (LIMITS[kind] ?? 0)) {
          if (kind === 'text' && file.size > (LIMITS.text ?? 0)) {
            // Show the beginning of large text files.
            const blob = await new Response(asReadableStream(readFileRange(file, 0, LIMITS.text!, ac.signal))).blob()
            setState({ status: 'ready', text: (await blob.text()) + '\n…' })
            return
          }
          setState({ status: 'unsupported' })
          return
        }
        let done = 0
        const blob = await readFileBlob(file, ac.signal, (n) => {
          done += n
          setState({ status: 'loading', progress: (done / Math.max(1, file.size)) * 100 })
        })
        if (ac.signal.aborted) return
        if (kind === 'text') {
          setState({ status: 'ready', text: await blob.text() })
          return
        }
        objectUrl = URL.createObjectURL(new Blob([blob], { type: safeType(kind, file.mime) }))
        setState({ status: 'ready', url: objectUrl })
      } catch (err) {
        if (!ac.signal.aborted) setState({ status: 'error', message: describeError(err) })
      }
    })()
    return () => {
      ac.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (token) unregisterStream(token)
    }
  }, [file, kind])
  return state
}

function Viewer({ file: current }: { file: DriveFile }) {
  const { t } = useTranslation()
  // The index is rebuilt on every sync update; keep the first snapshot so playback is not restarted.
  const [file] = useState(current)
  const kind = previewKind(file.mime, file.name)
  const state = useSource(file, kind)
  if (state.status === 'loading') {
    return (
      <div className="flex w-64 flex-col items-center gap-3 text-white/80">
        <Spinner className="size-8" />
        {state.progress > 0 && <Progress value={state.progress} className="bg-white/20" />}
      </div>
    )
  }
  if (state.status === 'error') return <p className="max-w-md rounded-lg bg-black/40 px-4 py-3 text-center text-sm text-white">{state.message}</p>
  if (state.status === 'unsupported') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-black/40 px-10 py-8 text-center text-white">
        <FileIcon item={file} className="size-16" />
        <div>
          <p className="font-medium">{file.name}</p>
          <p className="text-sm text-white/70">{t('preview.unavailable')}</p>
        </div>
        <Button onClick={() => downloadItems([file])}>
          <Download />
          {t('actions.download')} · {formatBytes(file.size)}
        </Button>
      </div>
    )
  }
  if (kind === 'image') return <img src={state.url} alt={file.name} className="max-h-full max-w-full object-contain" draggable={false} />
  if (kind === 'video') return <video src={state.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg bg-black" />
  if (kind === 'audio')
    return (
      <div className="flex w-full max-w-lg flex-col items-center gap-6 rounded-2xl bg-black/40 p-8">
        <FileIcon item={file} className="size-20" />
        <p className="text-center font-medium text-white">{file.name}</p>
        <audio src={state.url} controls autoPlay className="w-full" />
      </div>
    )
  if (kind === 'pdf') return <iframe src={state.url} title={file.name} className="size-full rounded-lg bg-white" />
  return <pre className="size-full max-w-5xl overflow-auto rounded-lg bg-card p-5 font-mono text-sm whitespace-pre-wrap text-card-foreground">{state.text}</pre>
}

export function PreviewModal() {
  const { t } = useTranslation()
  const preview = useUi((s) => s.preview)
  const close = useUi((s) => s.closePreview)
  const open = useUi((s) => s.openPreview)
  const openDialog = useUi((s) => s.openDialog)
  const file = useDrive((s) => (preview ? s.index.files.get(preview.key) : undefined))

  const pos = preview ? preview.keys.indexOf(preview.key) : -1
  const go = (delta: number) => {
    if (!preview) return
    const next = preview.keys[pos + delta]
    if (next) open(next, preview.keys)
  }

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'VIDEO' || (e.target as HTMLElement).tagName === 'AUDIO') return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <D.Root open={!!preview && !!file} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/85" />
        <D.Content className="fixed inset-0 z-50 flex flex-col outline-none" aria-describedby={undefined}>
          {file && (
            <>
              <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-white sm:px-5">
                <D.Close asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" aria-label={t('common.close')}>
                    <X />
                  </Button>
                </D.Close>
                <FileIcon item={file} className="size-5" />
                <div className="min-w-0 flex-1">
                  <D.Title className="truncate text-sm font-medium">{file.name}</D.Title>
                  <p className="text-xs text-white/60">
                    {formatBytes(file.size)} · {formatDate(file.date, true)}
                  </p>
                </div>
                <Tip label={t('actions.download')}>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => downloadItems([file])}>
                    <Download />
                  </Button>
                </Tip>
                <Tip label={t('actions.forward')}>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => openDialog({ kind: 'forward', files: [file] })}>
                    <Send />
                  </Button>
                </Tip>
                <Tip label={t('actions.details')}>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => openDialog({ kind: 'details', item: file })}>
                    <Info />
                  </Button>
                </Tip>
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:px-20 sm:pb-8" onClick={(e) => e.target === e.currentTarget && close()}>
                <Viewer key={file.key} file={file} />
                {pos > 0 && (
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    aria-label={t('preview.previous')}
                    className="absolute left-3 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                  >
                    <ChevronLeft />
                  </button>
                )}
                {preview && pos < preview.keys.length - 1 && (
                  <button
                    type="button"
                    onClick={() => go(1)}
                    aria-label={t('preview.next')}
                    className="absolute right-3 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                  >
                    <ChevronRight />
                  </button>
                )}
              </div>
            </>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
