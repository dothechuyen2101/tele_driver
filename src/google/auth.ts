import { create } from 'zustand'
import { useSettings } from '@/stores/settings'

export interface GoogleConfig {
  clientId: string
  apiKey: string
  /** Cloud project number; the Picker needs it to grant drive.file access. */
  appId: string
}

/** Per-deployment config from Vercel env vars, overridable in Settings. */
export function googleConfig(): GoogleConfig | undefined {
  const o = useSettings.getState().google
  const cfg = {
    clientId: o?.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: o?.apiKey || import.meta.env.VITE_GOOGLE_API_KEY || '',
    appId: o?.appId || import.meta.env.VITE_GOOGLE_APP_ID || '',
  }
  return cfg.clientId && cfg.apiKey && cfg.appId ? cfg : undefined
}

const scripts = new Map<string, Promise<void>>()

/** Loads a Google script once (only Google's own origins are allowed by the CSP). */
export function loadScript(src: string) {
  let p = scripts.get(src)
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scripts.delete(src)
        reject(new Error('GOOGLE_SCRIPT_FAILED'))
      }
      document.head.appendChild(s)
    })
    scripts.set(src, p)
  }
  return p
}

export const GIS_SRC = 'https://accounts.google.com/gsi/client'

export const SCOPES = {
  /** Files the user picks in the Picker; no Google app review needed. */
  file: 'https://www.googleapis.com/auth/drive.file',
  /** Whole folders; a restricted scope (Google review for public apps). */
  readonly: 'https://www.googleapis.com/auth/drive.readonly',
} as const

export type ScopeName = keyof typeof SCOPES

export class GoogleAuthError extends Error {
  constructor(message = 'GOOGLE_AUTH') {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

interface GoogleState {
  token?: string
  expiresAt?: number
  scopes: string[]
}

/** The access token lives only in memory; it lasts about an hour. */
export const useGoogle = create<GoogleState>(() => ({ scopes: [] }))

export function currentToken(scope: ScopeName = 'file'): string | undefined {
  const { token, expiresAt, scopes } = useGoogle.getState()
  if (!token || !expiresAt || expiresAt - 60_000 < Date.now()) return undefined
  // drive.readonly covers everything drive.file can read.
  return scopes.includes(SCOPES[scope]) || scopes.includes(SCOPES.readonly) ? token : undefined
}

/** Opens Google's consent popup; call it straight from a click so the popup is not blocked. */
export async function requestToken(scope: ScopeName): Promise<string> {
  const cfg = googleConfig()
  if (!cfg) throw new Error('GOOGLE_NOT_CONFIGURED')
  await loadScript(GIS_SRC)
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPES[scope],
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new GoogleAuthError(r.error || 'GOOGLE_AUTH'))
        useGoogle.setState({ token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000, scopes: r.scope.split(' ') })
        resolve(r.access_token)
      },
      error_callback: (e) => reject(new GoogleAuthError(e.type === 'popup_closed' ? 'GOOGLE_POPUP_CLOSED' : e.type === 'popup_failed_to_open' ? 'GOOGLE_POPUP_BLOCKED' : 'GOOGLE_AUTH')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/** A valid token, asking the user only when needed. */
export async function ensureToken(scope: ScopeName) {
  return currentToken(scope) ?? requestToken(scope)
}

export function disconnectGoogle() {
  const { token } = useGoogle.getState()
  if (token && typeof google !== 'undefined') google.accounts.oauth2.revoke(token)
  useGoogle.setState({ token: undefined, expiresAt: undefined, scopes: [] })
}
