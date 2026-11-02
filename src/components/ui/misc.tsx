import type { ReactNode } from 'react'
import { Switch as S, Tooltip as T } from 'radix-ui'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-4 animate-spin', className)} />
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {indeterminate ? (
        <div className="absolute inset-y-0 w-2/5 rounded-full bg-primary" style={{ animation: 'td-indeterminate 1.2s ease-in-out infinite' }} />
      ) : (
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  )
}

export function Switch({ checked, onCheckedChange, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[state=checked]:bg-primary"
    >
      <S.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </S.Root>
  )
}

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

export const TooltipProvider = T.Provider

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</kbd>
}
