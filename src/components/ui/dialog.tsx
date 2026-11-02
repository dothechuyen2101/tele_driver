import type { ComponentProps, ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Dialog = D.Root
export const DialogClose = D.Close

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  const { t } = useTranslation()
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-70 transition hover:bg-accent hover:opacity-100"
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  )
}

export function DialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 pr-6">
      <D.Title className="text-lg leading-tight font-semibold">{title}</D.Title>
      {description ? (
        <D.Description className="text-sm text-muted-foreground">{description}</D.Description>
      ) : (
        <D.Description className="sr-only">{title}</D.Description>
      )}
    </div>
  )
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}
