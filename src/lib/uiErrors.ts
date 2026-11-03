import { toast } from 'sonner'
import i18n from '@/i18n'
import { rpcError } from '@/telegram/errors'
import { errorMessage, isAbortError } from './utils'

const KNOWN: Record<string, string> = {
  VAULT_LOCKED: 'errors.vaultLocked',
  VAULT_EXISTS: 'errors.vaultExists',
  NO_VAULT: 'errors.noVault',
  FILE_INCOMPLETE: 'errors.fileIncomplete',
  FILE_GONE: 'errors.fileGone',
  SW_REQUIRED: 'errors.swRequired',
  SW_UNAVAILABLE: 'errors.swRequired',
  EMPTY_FILE: 'errors.emptyFile',
  FILE_TOO_LARGE: 'errors.fileTooLarge',
  NOTHING_TO_DOWNLOAD: 'errors.nothingToDownload',
  API_ID_INVALID: 'errors.apiIdInvalid',
  API_ID_PUBLISHED_FLOOD: 'errors.apiIdInvalid',
  CHAT_WRITE_FORBIDDEN: 'errors.writeForbidden',
  CHAT_ADMIN_REQUIRED: 'errors.adminRequired',
  CHANNELS_TOO_MUCH: 'errors.channelsTooMuch',
  WRONG_PASSWORD: 'errors.wrongPassword',
  FILE_TRUNCATED: 'errors.fileTruncated',
  BAD_LINK: 'errors.badLink',
  JOIN_FIRST: 'errors.joinFirst',
  INVITE_HASH_EXPIRED: 'errors.joinFirst',
  USERNAME_NOT_OCCUPIED: 'errors.usernameNotFound',
  USERNAME_INVALID: 'errors.usernameNotFound',
  SAME_AS_STORAGE: 'errors.sameAsStorage',
  GOOGLE_NOT_CONFIGURED: 'errors.googleNotConfigured',
  GOOGLE_AUTH: 'errors.googleAuth',
  GOOGLE_POPUP_CLOSED: 'errors.googlePopupClosed',
  GOOGLE_POPUP_BLOCKED: 'errors.googlePopupBlocked',
  GOOGLE_SCRIPT_FAILED: 'errors.googleScript',
  RANGE_UNSUPPORTED: 'errors.rangeUnsupported',
  CHAT_FORWARDS_RESTRICTED: 'errors.forwardsRestricted',
  SHORT_READ: 'errors.fileTruncated',
  DOWNLOAD_NOT_STARTED: 'errors.downloadNotStarted',
}

export function describeError(err: unknown): string {
  const code = rpcError(err) ?? errorMessage(err)
  if (code.startsWith('FLOOD_WAIT') || code.startsWith('FLOOD_PREMIUM_WAIT')) {
    const seconds = Number(code.split('_').pop()) || (err as { seconds?: number }).seconds || 0
    return i18n.t('errors.flood', { seconds })
  }
  if (code.startsWith('GOOGLE_HTTP_')) return i18n.t('errors.googleHttp', { status: code.slice(12) })
  const key = KNOWN[code]
  if (key) return i18n.t(key)
  if (/OperationError|decrypt/i.test(code)) return i18n.t('errors.decryptFailed')
  if (/network|websocket|timeout|disconnected/i.test(code)) return i18n.t('errors.network')
  return code
}

/** Shows a toast for an error unless it was a user cancellation. */
export function reportError(err: unknown, context?: string) {
  if (isAbortError(err)) return
  console.error(context ?? 'error', err)
  toast.error(context ? `${context}: ${describeError(err)}` : describeError(err))
}
