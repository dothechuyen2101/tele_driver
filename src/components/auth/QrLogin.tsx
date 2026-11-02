import { useEffect, useRef, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { KeyRound, Lock, RefreshCw, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { changeCredentials, completeLogin } from '@/app/session'
import { describeError } from '@/lib/uiErrors'
import { useApp } from '@/stores/app'
import { loginWithQr } from '@/telegram/auth'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Spinner } from '../ui/misc'
import { AuthShell, Card } from './AuthShell'

type Step = 'qr' | 'password' | 'checking' | 'error'

export function QrLogin() {
  const { t } = useTranslation()
  const creds = useApp((s) => s.creds)
  const [step, setStep] = useState<Step>('qr')
  const [qr, setQr] = useState<string>()
  const [hint, setHint] = useState<string>()
  const [wrong, setWrong] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [askedPassword, setAskedPassword] = useState(false)
  const resolvePassword = useRef<((v: string) => void) | null>(null)

  useEffect(() => {
    if (!creds) return
    const ac = new AbortController()
    loginWithQr(creds, {
      signal: ac.signal,
      onQr: async (url) => {
        const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 560, color: { dark: '#0b1220', light: '#ffffff' } })
        if (!ac.signal.aborted) setQr(dataUrl)
      },
      onPassword: (h, isWrong) =>
        new Promise<string>((resolve) => {
          setHint(h)
          setWrong(isWrong)
          setPassword('')
          setAskedPassword(true)
          setStep('password')
          resolvePassword.current = resolve
        }),
    })
      .then(async () => {
        if (ac.signal.aborted) return
        setStep('checking')
        await completeLogin()
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        setError(describeError(err))
        setStep('error')
      })
    return () => ac.abort()
  }, [creds, attempt])

  const retry = () => {
    setStep('qr')
    setQr(undefined)
    setError(undefined)
    setAttempt((a) => a + 1)
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setStep('checking')
    resolvePassword.current?.(password)
    resolvePassword.current = null
  }

  return (
    <AuthShell>
      <Card>
        {step === 'password' || (step === 'checking' && askedPassword) ? (
          <form onSubmit={submitPassword} className="grid gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Lock className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{t('login.passwordTitle')}</h1>
                <p className="text-sm text-muted-foreground">{t('login.passwordSubtitle')}</p>
              </div>
            </div>
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder={hint ? t('login.hint', { hint }) : t('login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={wrong}
              disabled={step === 'checking'}
            />
            {wrong && <p className="text-sm text-destructive">{t('login.wrongPassword')}</p>}
            <Button type="submit" size="lg" disabled={!password || step === 'checking'}>
              {step === 'checking' && <Spinner />}
              {t('login.signIn')}
            </Button>
          </form>
        ) : (
          <div className="grid gap-5">
            <div>
              <h1 className="text-xl font-semibold">{t('login.title')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('login.subtitle')}</p>
            </div>
            <div className="relative mx-auto grid aspect-square w-full max-w-[280px] place-items-center rounded-2xl border bg-white p-3 shadow-inner">
              {qr && step === 'qr' ? (
                <>
                  <img src={qr} alt={t('login.qrAlt')} className="size-full" draggable={false} />
                  <img src="/icons/icon.svg" alt="" className="absolute size-12 rounded-xl ring-4 ring-white" />
                </>
              ) : step === 'error' ? (
                <Button variant="outline" onClick={retry}>
                  <RefreshCw />
                  {t('common.retry')}
                </Button>
              ) : (
                <Spinner className="size-8 text-slate-400" />
              )}
            </div>
            {step === 'error' && error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <ol className="grid gap-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" />
                {t('login.step1')}
              </li>
              <li className="pl-6">{t('login.step2')}</li>
              <li className="pl-6">{t('login.step3')}</li>
            </ol>
            <div className="flex justify-center border-t pt-4">
              <Button variant="link" size="sm" onClick={() => void changeCredentials()}>
                <KeyRound />
                {t('login.changeApi')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AuthShell>
  )
}
