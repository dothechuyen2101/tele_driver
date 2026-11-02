import { useState, type FormEvent, type ReactNode } from 'react'
import { Tabs } from 'radix-ui'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { changeCredentials, chooseAnotherStorage, disablePasscode, enablePasscode, logout, refreshDrive, wipeEverything } from '@/app/session'
import { db } from '@/db/db'
import { lockVault } from '@/drive/vault'
import { languagePreference, setLanguage, type Language } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { reportError } from '@/lib/uiErrors'
import { cn } from '@/lib/utils'
import { useApp, useDrive } from '@/stores/app'
import { useSettings, type ThemePref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader } from '../ui/dialog'
import { Input } from '../ui/input'
import { Spinner, Switch } from '../ui/misc'

type Tab = 'general' | 'security' | 'storage' | 'account'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-3 py-1.5 text-sm transition', o.value === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="grid gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function General() {
  const { t } = useTranslation()
  const settings = useSettings()
  const [lang, setLang] = useState(languagePreference())
  return (
    <div className="grid gap-5">
      <Section title={t('language.title')}>
        <Segmented<Language | 'auto'>
          value={lang}
          onChange={(v) => {
            setLang(v)
            setLanguage(v)
          }}
          options={[
            { value: 'auto', label: t('language.auto') },
            { value: 'vi', label: 'Tiếng Việt' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Section>
      <Section title={t('theme.title')}>
        <Segmented<ThemePref>
          value={settings.theme}
          onChange={settings.setTheme}
          options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`theme.${v}`) }))}
        />
      </Section>
      <Section title={t('settings.transfers')}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">{t('settings.concurrency')}</span>
          <Segmented value={settings.uploadConcurrency} onChange={(v) => settings.set({ uploadConcurrency: v })} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <ToggleRow label={t('settings.cleanForward')} hint={t('settings.cleanForwardHint')} checked={settings.cleanForward} onChange={(v) => settings.set({ cleanForward: v })} />
      </Section>
    </div>
  )
}

function PasscodeForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = code.length >= 6 && code === confirm
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    try {
      await enablePasscode(code)
      toast.success(t('passcode.saved'))
      onDone()
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Input type="password" autoComplete="new-password" placeholder={t('passcode.new')} value={code} onChange={(e) => setCode(e.target.value)} />
      <Input type="password" autoComplete="new-password" placeholder={t('passcode.confirm')} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={confirm.length > 0 && confirm !== code} />
      <Button type="submit" disabled={!valid || busy}>
        {busy && <Spinner />}
        {t('common.save')}
      </Button>
      {code.length > 0 && code.length < 6 && <p className="text-xs text-muted-foreground sm:col-span-3">{t('passcode.minLength')}</p>}
    </form>
  )
}

function Security() {
  const { t } = useTranslation()
  const passcode = useApp((s) => s.passcodeEnabled)
  const settings = useSettings()
  const vault = useDrive((s) => s.index.vault)
  const vaultKey = useDrive((s) => s.vaultKey)
  const openDialog = useUi((s) => s.openDialog)
  const [editing, setEditing] = useState(false)
  return (
    <div className="grid gap-5">
      <Section title={t('passcode.title')} description={t('passcode.description')}>
        {passcode && !editing ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t('passcode.change')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void disablePasscode()
                  .then(() => toast.success(t('passcode.removed')))
                  .catch((e) => reportError(e))
              }
            >
              {t('passcode.remove')}
            </Button>
          </div>
        ) : (
          <PasscodeForm onDone={() => setEditing(false)} />
        )}
        {passcode && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">{t('passcode.autoLock')}</span>
            <Segmented
              value={settings.autoLockMinutes}
              onChange={(v) => settings.set({ autoLockMinutes: v })}
              options={[0, 5, 15, 30, 60].map((m) => ({ value: m, label: m ? t('passcode.minutes', { count: m }) : t('passcode.never') }))}
            />
          </div>
        )}
      </Section>
      <Section title={t('vault.title')} description={t('vault.description')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', !vault ? 'bg-muted text-muted-foreground' : vaultKey ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
            {!vault ? t('vault.statusNone') : vaultKey ? t('vault.statusUnlocked') : t('vault.statusLocked')}
          </span>
          {!vault && (
            <Button size="sm" onClick={() => openDialog({ kind: 'vault', mode: 'create' })}>
              {t('vault.createAction')}
            </Button>
          )}
          {vault && !vaultKey && (
            <Button size="sm" onClick={() => openDialog({ kind: 'vault', mode: 'unlock' })}>
              {t('vault.unlockAction')}
            </Button>
          )}
          {vault && vaultKey && (
            <>
              <Button variant="outline" size="sm" onClick={() => void lockVault()}>
                {t('vault.lock')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'vault', mode: 'change' })}>
                {t('vault.changeAction')}
              </Button>
            </>
          )}
        </div>
        <ToggleRow label={t('settings.encryptAll')} hint={t('settings.encryptAllHint')} checked={settings.encryptAll} onChange={(v) => settings.set({ encryptAll: v })} />
        {vaultKey && !passcode && <p className="text-xs text-muted-foreground">{t('vault.rememberHint')}</p>}
      </Section>
    </div>
  )
}

function Storage() {
  const { t } = useTranslation()
  const storage = useApp((s) => s.storage)
  const index = useDrive((s) => s.index)
  const close = useUi((s) => s.closeDialog)
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid gap-5">
      <Section title={t('settings.currentStorage')}>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{storage?.kind === 'self' ? t('storage.saved') : storage?.title}</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.stats', { files: index.fileCount, folders: index.folders.size, size: formatBytes(index.totalSize) })}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              close()
              chooseAnotherStorage()
            }}
          >
            {t('common.change')}
          </Button>
        </div>
      </Section>
      <Section title={t('settings.maintenance')}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              refreshDrive(true)
                .then(() => toast.success(t('settings.resynced')))
                .catch((e) => reportError(e))
                .finally(() => setBusy(false))
            }}
          >
            {busy && <Spinner />}
            {t('settings.resync')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void db.thumbs.clear().then(() => toast.success(t('settings.cacheCleared')))}>
            {t('settings.clearCache')}
          </Button>
        </div>
      </Section>
    </div>
  )
}

function Account() {
  const { t } = useTranslation()
  const me = useApp((s) => s.me)
  const creds = useApp((s) => s.creds)
  const openDialog = useUi((s) => s.openDialog)
  return (
    <div className="grid gap-5">
      <Section title={t('account.title')}>
        <div className="grid gap-1 text-sm">
          <div className="font-medium">
            {[me?.firstName, me?.lastName].filter(Boolean).join(' ')}
            {me?.premium && <span className="ml-2 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-600 dark:text-violet-400">Premium</span>}
          </div>
          {me?.username && <div className="text-muted-foreground">@{me.username}</div>}
          <div className="text-xs text-muted-foreground">
            ID {me?.id} · API ID {creds?.apiId}
          </div>
          <div className="text-xs text-muted-foreground">{t('account.limit', { size: me?.premium ? '4 GB' : '2 GB' })}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t('account.logout')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              openDialog({ kind: 'confirm', title: t('account.changeApiTitle'), message: t('account.changeApiMessage'), confirmLabel: t('common.continue'), onConfirm: changeCredentials })
            }
          >
            {t('account.changeApi')}
          </Button>
        </div>
      </Section>
      <Section title={t('account.dangerZone')} description={t('account.wipeDescription')}>
        <div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => openDialog({ kind: 'confirm', title: t('account.wipeTitle'), message: t('account.wipeDescription'), danger: true, confirmLabel: t('account.wipe'), onConfirm: wipeEverything })}
          >
            {t('account.wipe')}
          </Button>
        </div>
      </Section>
    </div>
  )
}

export function SettingsDialog({ tab = 'general', onClose }: { tab?: Tab; onClose: () => void }) {
  const { t } = useTranslation()
  const tabs: Tab[] = ['general', 'security', 'storage', 'account']
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-5 sm:min-h-[480px]">
        <DialogHeader title={t('settings.title')} />
        <Tabs.Root defaultValue={tab} className="grid gap-5">
          <Tabs.List className="flex gap-1 overflow-x-auto border-b">
            {tabs.map((v) => (
              <Tabs.Trigger
                key={v}
                value={v}
                className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground"
              >
                {t(`settings.${v}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="general">
            <General />
          </Tabs.Content>
          <Tabs.Content value="security">
            <Security />
          </Tabs.Content>
          <Tabs.Content value="storage">
            <Storage />
          </Tabs.Content>
          <Tabs.Content value="account">
            <Account />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
