import { useState, type FormEvent } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { unlockApp, wipeEverything } from '@/app/session'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Spinner } from '../ui/misc'
import { AuthShell, Card } from './AuthShell'

export function PasscodeScreen() {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code) return
    setBusy(true)
    setWrong(false)
    const ok = await unlockApp(code)
    if (!ok) {
      setWrong(true)
      setCode('')
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <form onSubmit={submit} className="grid gap-4 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="size-7" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('passcode.lockedTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('passcode.lockedSubtitle')}</p>
          </div>
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            className="h-11 text-center text-lg tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={wrong}
            disabled={busy}
            placeholder="••••••"
          />
          {wrong && <p className="text-sm text-destructive">{t('passcode.wrong')}</p>}
          <Button type="submit" size="lg" disabled={!code || busy}>
            {busy && <Spinner />}
            {t('passcode.unlock')}
          </Button>
          <div className="border-t pt-3">
            {confirmWipe ? (
              <div className="grid gap-2 text-sm">
                <p className="text-muted-foreground">{t('passcode.forgotWarning')}</p>
                <div className="flex justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmWipe(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void wipeEverything()}>
                    {t('passcode.wipe')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="link" size="sm" onClick={() => setConfirmWipe(true)}>
                {t('passcode.forgot')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </AuthShell>
  )
}
