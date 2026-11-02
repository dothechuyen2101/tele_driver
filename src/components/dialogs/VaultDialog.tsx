import { useState, type FormEvent } from 'react'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { changeVaultPassword, createVaultForStorage, unlockVaultForStorage } from '@/drive/vault'
import { WrongPasswordError } from '@/crypto/vault'
import { describeError } from '@/lib/uiErrors'
import { useDrive } from '@/stores/app'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../ui/dialog'
import { Input, Label } from '../ui/input'
import { Spinner } from '../ui/misc'

const MIN_LENGTH = 8

export function VaultDialog({ mode: requested, then, onClose }: { mode: 'create' | 'unlock' | 'change'; then?: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const hasVault = useDrive((s) => !!s.index.vault)
  // A vault may have appeared (another device) or vanished since the dialog was requested.
  const mode = requested === 'create' && hasVault ? 'unlock' : requested === 'unlock' && !hasVault ? 'create' : requested
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const needsConfirm = mode !== 'unlock'
  const valid = mode === 'unlock' ? password.length > 0 : password.length >= MIN_LENGTH && password === confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(undefined)
    try {
      if (mode === 'create') await createVaultForStorage(password)
      else if (mode === 'unlock') await unlockVaultForStorage(password)
      else await changeVaultPassword(password)
      onClose()
      then?.()
    } catch (err) {
      setError(err instanceof WrongPasswordError ? t('vault.wrong') : describeError(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title={t(`vault.${mode}Title`)} description={t(`vault.${mode}Description`)} />
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="vault-pw">{mode === 'change' ? t('vault.newPassword') : t('vault.password')}</Label>
            <Input id="vault-pw" type="password" autoFocus autoComplete={mode === 'unlock' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            {needsConfirm && password.length > 0 && password.length < MIN_LENGTH && <p className="text-xs text-muted-foreground">{t('vault.minLength', { count: MIN_LENGTH })}</p>}
          </div>
          {needsConfirm && (
            <div className="grid gap-2">
              <Label htmlFor="vault-pw2">{t('vault.confirm')}</Label>
              <Input id="vault-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} aria-invalid={confirm.length > 0 && confirm !== password} />
            </div>
          )}
          {mode === 'create' && (
            <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex gap-2">
                <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                {t('vault.howItWorks')}
              </p>
              <p className="flex gap-2 font-medium text-foreground">
                <TriangleAlert className="size-4 shrink-0 text-warning" />
                {t('vault.noRecovery')}
              </p>
            </div>
          )}
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy && <Spinner />}
              {t(`vault.${mode}Action`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
