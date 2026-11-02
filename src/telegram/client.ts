import { Logger, TelegramClient } from 'teleproto'
import { LogLevel } from 'teleproto/extensions/Logger'
import { StringSession, type StoredUpdateState } from 'teleproto/sessions'
import { UpdateConnectionState } from 'teleproto/network'
import { getSecret, setSecret } from '@/crypto/secrets'

export interface ApiCreds {
  apiId: number
  apiHash: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** StringSession that writes itself (and the update state) to the secret store. */
class PersistedSession extends StringSession {
  private last = ''
  private updateTimer: ReturnType<typeof setTimeout> | undefined
  persist = false

  save() {
    const value = super.save()
    if (this.persist && value && value !== this.last) {
      this.last = value
      void setSecret('session', value).catch(() => {})
    }
    return value
  }

  restoreUpdateState(state: StoredUpdateState | undefined) {
    super.setUpdateState(state)
  }

  setUpdateState(state: StoredUpdateState | undefined) {
    super.setUpdateState(state)
    if (!this.persist) return
    clearTimeout(this.updateTimer)
    this.updateTimer = setTimeout(() => void setSecret('updates', state ?? null).catch(() => {}), 2000)
  }
}

let client: TelegramClient | null = null
let session: PersistedSession | null = null
const statusListeners = new Set<(s: ConnectionStatus) => void>()
let status: ConnectionStatus = 'disconnected'

function setStatus(s: ConnectionStatus) {
  status = s
  for (const l of statusListeners) l(s)
}

export function onConnectionStatus(listener: (s: ConnectionStatus) => void) {
  statusListeners.add(listener)
  listener(status)
  return () => statusListeners.delete(listener)
}

function platformName() {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Web'
}

function browserName() {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Browser'
}

/**
 * Creates the singleton client. With `restore`, the saved session and update
 * state are loaded from the secret store; otherwise it starts logged out.
 */
export async function createClient(creds: ApiCreds, restore: boolean) {
  await destroyClient()
  const saved = restore ? await getSecret<string>('session') : undefined
  const updates = restore ? await getSecret<StoredUpdateState | null>('updates') : undefined
  session = new PersistedSession(saved ?? '')
  if (updates) session.restoreUpdateState(updates)
  // A fresh client only persists once the login succeeded (see persistSession).
  session.persist = restore
  client = new TelegramClient(session, creds.apiId, creds.apiHash, {
    connectionRetries: 10,
    autoReconnect: true,
    floodSleepThreshold: 120,
    deviceModel: `TeleDriver ${browserName()}`,
    systemVersion: platformName(),
    appVersion: '0.1.0',
    baseLogger: new Logger(LogLevel.ERROR),
  })
  client.addEventHandler((update: unknown) => {
    if (update instanceof UpdateConnectionState) {
      setStatus(update.state === UpdateConnectionState.connected ? 'connected' : 'disconnected')
    }
  })
  return client
}

export function getClient(): TelegramClient {
  if (!client) throw new Error('Telegram client is not initialised')
  return client
}

export function hasClient() {
  return client !== null
}

let connecting: Promise<void> | null = null

export async function ensureConnected() {
  const c = getClient()
  if (c.connected) return
  if (!connecting) {
    setStatus('connecting')
    connecting = c
      .connect()
      .then(() => setStatus('connected'))
      .catch((err) => {
        setStatus('disconnected')
        throw err
      })
      .finally(() => {
        connecting = null
      })
  }
  await connecting
}

export async function destroyClient() {
  const c = client
  client = null
  session = null
  if (c) {
    try {
      await c.destroy()
    } catch {
      /* already closed */
    }
  }
  setStatus('disconnected')
}

/** Starts writing the session to the secret store; called right after a successful login. */
export function persistSession() {
  if (!session) return
  session.persist = true
  session.save()
}
