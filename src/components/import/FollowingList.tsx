import { useState } from 'react'
import { HardDrive, Megaphone, Pause, Play, RefreshCw, Trash, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { runChatSubscription, runDriveSubscription, setSubscriptionPaused, unfollow } from '@/drive/imports/subscriptions'
import { folderPath, type Subscription } from '@/drive/model'
import { formatDate } from '@/lib/format'
import { reportError } from '@/lib/uiErrors'
import { useDrive } from '@/stores/app'
import { useUi } from '@/stores/ui'
import { Button } from '../ui/button'
import { Spinner, Tip } from '../ui/misc'

export function FollowingList() {
  const { t } = useTranslation()
  const index = useDrive((s) => s.index)
  const openDialog = useUi((s) => s.openDialog)
  const [busy, setBusy] = useState<number | null>(null)

  const runNow = async (sub: Subscription) => {
    setBusy(sub.msgId)
    try {
      const n = sub.source.startsWith('gd:') ? await runDriveSubscription(sub) : await runChatSubscription(sub, index)
      toast.success(n ? t('imports.follow.queued', { count: n }) : t('imports.follow.upToDate'))
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(null)
    }
  }

  if (!index.subs.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <RefreshCw className="size-9 text-muted-foreground" />
        <p className="font-medium">{t('imports.follow.empty')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('imports.follow.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('imports.follow.notice')}</p>
      {index.subs.map((sub) => {
        const drive = sub.source.startsWith('gd:')
        const Icon = drive ? HardDrive : sub.source.startsWith('c') ? Megaphone : Users
        const target = [t('nav.myDrive'), ...folderPath(index, sub.folderId).map((f) => f.name)].join(' / ')
        return (
          <div key={sub.msgId} className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{sub.title}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {sub.paused ? t('imports.follow.paused') : drive ? t('imports.follow.manual') : t('imports.follow.auto')}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">→ {target}</div>
              <div className="text-xs text-muted-foreground">
                {!drive && `${[...sub.kinds].map((k) => t(`imports.kinds.${k}`)).join(', ')} · `}
                {sub.lastRun ? t('imports.follow.lastRun', { date: formatDate(sub.lastRun, true) }) : t('imports.follow.never')}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => void runNow(sub)} disabled={busy !== null}>
                {busy === sub.msgId ? <Spinner /> : <RefreshCw />}
                {t('imports.follow.runNow')}
              </Button>
              {!drive && (
                <Tip label={sub.paused ? t('imports.resume') : t('imports.pause')}>
                  <Button variant="ghost" size="icon-sm" onClick={() => void setSubscriptionPaused(sub, !sub.paused).catch((e) => reportError(e))}>
                    {sub.paused ? <Play /> : <Pause />}
                  </Button>
                </Tip>
              )}
              <Tip label={t('imports.follow.unfollow')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    openDialog({
                      kind: 'confirm',
                      title: t('imports.follow.unfollowTitle', { name: sub.title }),
                      message: t('imports.follow.unfollowMessage'),
                      confirmLabel: t('imports.follow.unfollow'),
                      onConfirm: () => unfollow(sub, index),
                    })
                  }
                >
                  <Trash />
                </Button>
              </Tip>
            </div>
          </div>
        )
      })}
    </div>
  )
}
