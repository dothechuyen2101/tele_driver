import { useEffect } from 'react'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { boot, changeCredentials, lockApp, logout } from '@/app/session'
import { hasActiveUploads } from '@/drive/uploads'
import { useApp } from '@/stores/app'
import { useSettings } from '@/stores/settings'
import { ApiKeySetup } from './components/auth/ApiKeySetup'
import { PasscodeScreen } from './components/auth/PasscodeScreen'
import { QrLogin } from './components/auth/QrLogin'
import { Logo } from './components/common'
import { DriveApp } from './components/drive/DriveApp'
import { StoragePicker } from './components/StoragePicker'
import { Button } from './components/ui/button'
import { Spinner, TooltipProvider } from './components/ui/misc'

let booted = false

/** Locks the app after a period of inactivity when a passcode is set. */
function useAutoLock() {
  const phase = useApp((s) => s.phase)
  const enabled = useApp((s) => s.passcodeEnabled)
  const minutes = useSettings((s) => s.autoLockMinutes)
  useEffect(() => {
    if (!enabled || !minutes || phase === 'locked' || phase === 'boot') return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const
    for (const ev of events) window.addEventListener(ev, bump, { passive: true })
    const timer = setInterval(() => {
      if (Date.now() - last > minutes * 60_000 && !hasActiveUploads()) void lockApp()
    }, 15_000)
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump)
      clearInterval(timer)
    }
  }, [enabled, minutes, phase])
}

function Splash() {
  const { t } = useTranslation()
  const error = useApp((s) => s.bootError)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo className="size-14" />
      {error ? (
        <>
          <p className="max-w-sm text-sm text-destructive">{error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void boot()}>
              <RefreshCw />
              {t('common.retry')}
            </Button>
            <Button variant="ghost" onClick={() => void changeCredentials()}>
              {t('account.changeApi')}
            </Button>
            <Button variant="ghost" onClick={() => void logout()}>
              {t('account.logout')}
            </Button>
          </div>
        </>
      ) : (
        <Spinner className="size-6 text-muted-foreground" />
      )}
    </div>
  )
}

function Screen() {
  const phase = useApp((s) => s.phase)
  switch (phase) {
    case 'boot':
      return <Splash />
    case 'locked':
      return <PasscodeScreen />
    case 'setup':
      return <ApiKeySetup />
    case 'login':
      return <QrLogin />
    case 'storage':
      return <StoragePicker />
    case 'ready':
      return <DriveApp />
  }
}

export function App() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    if (!booted) {
      booted = true
      void boot()
    }
  }, [])
  useAutoLock()
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Screen />
      </BrowserRouter>
      <Toaster theme={theme} position="bottom-left" richColors closeButton />
    </TooltipProvider>
  )
}
