import { create } from 'zustand'
import type { Me } from '@/telegram/auth'
import type { ApiCreds, ConnectionStatus } from '@/telegram/client'
import type { StorageRef } from '@/telegram/peers'
import { EMPTY_INDEX, type DecryptedMeta, type DriveIndex } from '@/drive/model'

export type Phase = 'boot' | 'locked' | 'setup' | 'login' | 'storage' | 'ready'

export interface SyncProgress {
  running: boolean
  scanned: number
  total?: number
  full: boolean
  error?: string
  lastSync?: number
}

interface AppState {
  phase: Phase
  creds?: ApiCreds
  me?: Me
  storage?: StorageRef
  conn: ConnectionStatus
  sync: SyncProgress
  passcodeEnabled: boolean
  bootError?: string
}

export const useApp = create<AppState>(() => ({
  phase: 'boot',
  conn: 'disconnected',
  sync: { running: false, scanned: 0, full: false },
  passcodeEnabled: false,
}))

interface DriveState {
  index: DriveIndex
  /** Vault key of the current storage chat while unlocked. */
  vaultKey?: CryptoKey
  /** Decrypted name/mime of encrypted files, keyed by their `en=` value. */
  decrypted: Map<string, DecryptedMeta>
}

export const useDrive = create<DriveState>(() => ({
  index: EMPTY_INDEX,
  decrypted: new Map(),
}))

export function requireStorage() {
  const { storage, me } = useApp.getState()
  if (!storage || !me) throw new Error('No storage selected')
  return { ref: storage, me }
}
