import { useState } from 'react'
import { Tabs } from 'radix-ui'
import { HardDrive, History, RefreshCw, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FollowingList } from './FollowingList'
import { GoogleImport } from './GoogleImport'
import { ImportHistory } from './ImportHistory'
import { TelegramImport } from './TelegramImport'

type Tab = 'telegram' | 'google' | 'following' | 'history'

const TABS: { value: Tab; icon: typeof Send }[] = [
  { value: 'telegram', icon: Send },
  { value: 'google', icon: HardDrive },
  { value: 'following', icon: RefreshCw },
  { value: 'history', icon: History },
]

export function ImportPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('telegram')
  const started = () => setTab('history')
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 scrollbar-thin">
      <div className="mx-auto grid max-w-4xl gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t('imports.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('imports.subtitle')}</p>
        </div>
        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)} className="grid gap-5">
          <Tabs.List className="flex gap-1 overflow-x-auto border-b">
            {TABS.map(({ value, icon: Icon }) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground"
              >
                <Icon className="size-4" />
                {t(`imports.tabs.${value}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="telegram">
            <TelegramImport onStarted={started} />
          </Tabs.Content>
          <Tabs.Content value="google">
            <GoogleImport onStarted={started} />
          </Tabs.Content>
          <Tabs.Content value="following">
            <FollowingList />
          </Tabs.Content>
          <Tabs.Content value="history">
            <ImportHistory />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  )
}
