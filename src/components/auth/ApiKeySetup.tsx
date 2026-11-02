import { useState, type FormEvent } from 'react'
import { ExternalLink, KeyRound } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { saveCredentials } from '@/app/session'
import { reportError } from '@/lib/uiErrors'
import { Button } from '../ui/button'
import { Input, Label } from '../ui/input'
import { Spinner } from '../ui/misc'
import { AuthShell, Card } from './AuthShell'

export function ApiKeySetup() {
  const { t } = useTranslation()
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [busy, setBusy] = useState(false)
  const idValid = /^\d{3,12}$/.test(apiId.trim())
  const hashValid = /^[a-f0-9]{32}$/i.test(apiHash.trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!idValid || !hashValid) return
    setBusy(true)
    try {
      await saveCredentials({ apiId: Number(apiId.trim()), apiHash: apiHash.trim().toLowerCase() })
    } catch (err) {
      reportError(err)
      setBusy(false)
    }
  }

  const steps = ['setup.step1', 'setup.step2', 'setup.step3', 'setup.step4']

  return (
    <AuthShell wide>
      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <Card>
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{t('setup.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('setup.subtitle')}</p>
            </div>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="api-id">API ID</Label>
              <Input
                id="api-id"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1234567"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                aria-invalid={apiId !== '' && !idValid}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="api-hash">API Hash</Label>
              <Input
                id="api-hash"
                autoComplete="off"
                spellCheck={false}
                placeholder="0123456789abcdef0123456789abcdef"
                className="font-mono"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                aria-invalid={apiHash !== '' && !hashValid}
              />
              {apiHash !== '' && !hashValid && <p className="text-xs text-destructive">{t('setup.hashInvalid')}</p>}
            </div>
            <Button type="submit" size="lg" disabled={!idValid || !hashValid || busy} className="mt-2">
              {busy && <Spinner />}
              {t('setup.continue')}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('setup.privacy')}</p>
          </form>
        </Card>
        <Card className="bg-muted/40">
          <h2 className="mb-4 font-semibold">{t('setup.howTo')}</h2>
          <ol className="grid gap-3 text-sm">
            {steps.map((key, i) => (
              <li key={key} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">
                  <Trans
                    i18nKey={key}
                    components={{
                      b: <strong />,
                      a: <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline-offset-4 hover:underline" />,
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>
          <Button asChild variant="outline" className="mt-6 w-full">
            <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer noopener">
              my.telegram.org
              <ExternalLink />
            </a>
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t('setup.accountTip')}</p>
        </Card>
      </div>
    </AuthShell>
  )
}
