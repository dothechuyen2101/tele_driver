/**
 * App lifecycle: boot → (passcode) → API credentials → QR login → storage
 * choice → drive. Every step persists what it needs in the secret store.
 */
import { db, kvDel, wipeAll } from '@/db/db'
import { delSecret, getSecret, hasPasscode, isUnlocked, lock, removePasscode, setPasscode, setSecret, unlock } from '@/crypto/secrets'
import { clearFileKeyCache, exportVaultKey } from '@/crypto/vault'
import { EMPTY_INDEX } from '@/drive/model'
import { autoPurgeTrash } from '@/drive/ops'
import { startLiveUpdates, syncStorage } from '@/drive/sync'
import { restoreVaultKey } from '@/drive/vault'
import { describeError } from '@/lib/uiErrors'
import { useApp, useDrive } from '@/stores/app'
import { fetchMe, logOut, type Me } from '@/telegram/auth'
import { createClient, destroyClient, ensureConnected, hasClient, onConnectionStatus, persistSession, type ApiCreds } from '@/telegram/client'
import { isRpc, SESSION_DEAD } from '@/telegram/errors'
import { chatKeyOf, type StorageRef } from '@/telegram/peers'

let stopLive: (() => void) | null = null

onConnectionStatus((conn) => useApp.setState({ conn }))

function resetDrive() {
  stopLive?.()
  stopLive = null
  clearFileKeyCache()
  useDrive.setState({ index: EMPTY_INDEX, vaultKey: undefined, decrypted: new Map() })
}

async function clearAccountData() {
  resetDrive()
  for (const name of ['session', 'updates', 'me', 'storage']) await delSecret(name)
  const vaultSecrets = await db.kv.where('key').startsWith('secret:vault:').primaryKeys()
  for (const key of vaultSecrets) await kvDel(key)
  await db.transaction('rw', db.entries, db.thumbs, db.syncState, async () => {
    await db.entries.clear()
    await db.thumbs.clear()
    await db.syncState.clear()
  })
}

async function handleDeadSession() {
  const { creds } = useApp.getState()
  await destroyClient()
  await clearAccountData()
  if (creds) await createClient(creds, false)
  useApp.setState({ phase: 'login', me: undefined, storage: undefined })
}

export async function boot() {
  useApp.setState({ phase: 'boot', bootError: undefined })
  try {
    const passcodeEnabled = await hasPasscode()
    useApp.setState({ passcodeEnabled })
    if (passcodeEnabled && !isUnlocked()) {
      useApp.setState({ phase: 'locked' })
      return
    }
    const creds = await getSecret<ApiCreds>('creds')
    if (!creds) {
      useApp.setState({ phase: 'setup' })
      return
    }
    const session = await getSecret<string>('session')
    if (!session) {
      await createClient(creds, false)
      useApp.setState({ phase: 'login', creds })
      return
    }
    await createClient(creds, true)
    const me = await getSecret<Me>('me')
    const storage = await getSecret<StorageRef>('storage')
    useApp.setState({ creds, me, storage })
    if (me && storage) {
      // Show the cached drive right away; connect and sync in the background.
      useApp.setState({ phase: 'ready' })
      void startDrive()
      return
    }
    await ensureConnected()
    const fresh = await fetchMe()
    await setSecret('me', fresh)
    useApp.setState({ me: fresh, phase: 'storage' })
  } catch (err) {
    if (isRpc(err, ...SESSION_DEAD)) await handleDeadSession()
    else useApp.setState({ bootError: describeError(err) })
  }
}

export async function startDrive() {
  const { storage, me } = useApp.getState()
  if (!storage || !me || !hasClient()) return
  stopLive?.()
  stopLive = null
  await restoreVaultKey()
  try {
    await ensureConnected()
    void fetchMe()
      .then(async (fresh) => {
        await setSecret('me', fresh)
        useApp.setState({ me: fresh })
      })
      .catch(() => {})
    stopLive = startLiveUpdates(storage, me.id)
    await syncStorage(storage)
    await autoPurgeTrash(30)
  } catch (err) {
    if (isRpc(err, ...SESSION_DEAD)) await handleDeadSession()
    else console.warn('drive start failed', err)
  }
}

export async function saveCredentials(creds: ApiCreds) {
  await setSecret('creds', creds)
  await createClient(creds, false)
  useApp.setState({ creds, phase: 'login' })
}

export async function changeCredentials() {
  await destroyClient()
  await clearAccountData()
  await delSecret('creds')
  useApp.setState({ phase: 'setup', creds: undefined, me: undefined, storage: undefined })
}

export async function completeLogin() {
  persistSession()
  const me = await fetchMe()
  await setSecret('me', me)
  useApp.setState({ me, phase: 'storage' })
}

export async function selectStorage(ref: StorageRef) {
  resetDrive()
  await setSecret('storage', ref)
  useApp.setState({ storage: ref, phase: 'ready', sync: { running: false, scanned: 0, full: false } })
  void startDrive()
}

export function chooseAnotherStorage() {
  useApp.setState({ phase: 'storage' })
}

export async function refreshDrive(full = true) {
  const { storage } = useApp.getState()
  if (!storage) return
  await ensureConnected()
  await syncStorage(storage, { full })
}

export async function lockApp() {
  if (!(await hasPasscode())) return
  resetDrive()
  await destroyClient()
  lock()
  useApp.setState({ phase: 'locked', me: undefined, storage: undefined, creds: undefined })
}

export async function unlockApp(code: string) {
  const ok = await unlock(code)
  if (ok) await boot()
  return ok
}

export async function logout() {
  try {
    if (hasClient()) await logOut()
  } catch {
    /* ignore */
  }
  const { creds } = useApp.getState()
  await destroyClient()
  await clearAccountData()
  if (creds) await createClient(creds, false)
  useApp.setState({ phase: creds ? 'login' : 'setup', me: undefined, storage: undefined })
}

/** Logs out and removes every trace of TeleDriver from this browser. */
export async function wipeEverything() {
  try {
    if (hasClient()) await logOut()
  } catch {
    /* ignore */
  }
  await destroyClient()
  await wipeAll()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('td-')) localStorage.removeItem(key)
    await caches.delete('td-share')
  } catch {
    /* ignore */
  }
  location.replace('/')
}

export async function enablePasscode(code: string) {
  await setPasscode(code)
  // Re-seal the cached vault key, which is only kept on disk while a passcode protects it.
  const { vaultKey } = useDrive.getState()
  const { storage } = useApp.getState()
  if (vaultKey && storage) await setSecret(`vault:${chatKeyOf(storage)}`, await exportVaultKey(vaultKey))
  useApp.setState({ passcodeEnabled: true })
}

export async function disablePasscode() {
  await removePasscode()
  const vaultSecrets = await db.kv.where('key').startsWith('secret:vault:').primaryKeys()
  for (const key of vaultSecrets) await kvDel(key)
  useApp.setState({ passcodeEnabled: false })
}
