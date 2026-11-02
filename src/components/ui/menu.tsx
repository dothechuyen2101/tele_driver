import type { ComponentProps, ReactNode } from 'react'
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui'
import { cn } from '@/lib/utils'

/** One action, rendered the same way in dropdown and context menus. */
export interface MenuAction {
  key: string
  label: ReactNode
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

const contentClass =
  'z-50 min-w-[12rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none'
const itemClass =
  'relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

function Items({ actions, Item, Separator }: { actions: MenuAction[]; Item: typeof DM.Item; Separator: typeof DM.Separator }) {
  return (
    <>
      {actions.map((a) => (
        <div key={a.key} className="contents">
          {a.separatorBefore && <Separator className="my-1 h-px bg-border" />}
          <Item
            className={cn(itemClass, a.danger && 'text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive')}
            disabled={a.disabled}
            onSelect={a.onSelect}
          >
            {a.icon}
            <span className="flex-1">{a.label}</span>
            {a.shortcut && <span className="ml-4 text-xs tracking-wide text-muted-foreground">{a.shortcut}</span>}
          </Item>
        </div>
      ))}
    </>
  )
}

export function ActionDropdown({
  actions,
  children,
  align = 'end',
  ...props
}: { actions: MenuAction[]; children: ReactNode; align?: 'start' | 'end' } & ComponentProps<typeof DM.Root>) {
  return (
    <DM.Root {...props}>
      <DM.Trigger asChild>{children}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={4} className={contentClass} onCloseAutoFocus={(e) => e.preventDefault()}>
          <Items actions={actions} Item={DM.Item} Separator={DM.Separator} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

export function ActionContextMenu({
  actions,
  children,
  onOpenChange,
}: {
  actions: MenuAction[]
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <CM.Root onOpenChange={onOpenChange}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={contentClass}>
          <Items actions={actions} Item={CM.Item as typeof DM.Item} Separator={CM.Separator as typeof DM.Separator} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}
