/** Telegram RPC error string (e.g. `FILE_REFERENCE_EXPIRED`), if `err` is one. */
export function rpcError(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'errorMessage' in err) return String((err as { errorMessage: unknown }).errorMessage)
  return undefined
}

export function isRpc(err: unknown, ...codes: string[]) {
  const code = rpcError(err)
  return !!code && codes.some((c) => code === c || code.startsWith(c))
}

/** Edits that Telegram refuses on this message; we fall back to a `#td_patch` record. */
export const EDIT_REFUSED = [
  'MESSAGE_EDIT_TIME_EXPIRED',
  'MESSAGE_AUTHOR_REQUIRED',
  'MESSAGE_ID_INVALID',
  'CHAT_ADMIN_REQUIRED',
  'CHAT_WRITE_FORBIDDEN',
]

export const SESSION_DEAD = ['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED', 'AUTH_KEY_INVALID', 'SESSION_EXPIRED']
