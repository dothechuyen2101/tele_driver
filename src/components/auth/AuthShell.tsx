import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Logo, PreferenceButtons } from '../common'

export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-full flex-col bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)]">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">TeleDriver</span>
        </div>
        <PreferenceButtons />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-10 sm:items-center sm:pt-0">
        <div className={wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}>{children}</div>
      </main>
      <footer className="flex items-center justify-center gap-1.5 px-4 pb-5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        {t('auth.footer')}
      </footer>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8 ${className}`}>{children}</div>
}
