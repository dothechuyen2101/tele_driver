import { Api } from 'teleproto'
import { toBase64Url } from '@/lib/bytes'
import { ensureConnected, getClient, type ApiCreds } from './client'
import { isRpc } from './errors'

export interface QrLoginHandlers {
  onQr: (url: string, expiresAt: number) => void
  /** Asks for the 2FA password; `wrong` is true after a failed attempt. */
  onPassword: (hint: string | undefined, wrong: boolean) => Promise<string>
  signal: AbortSignal
}

export async function loginWithQr(creds: ApiCreds, h: QrLoginHandlers): Promise<Api.User> {
  await ensureConnected()
  const client = getClient()
  let wrongPassword = false
  let fatal: unknown
  const user = await client.signInUserWithQrCode(
    { apiId: creds.apiId, apiHash: creds.apiHash },
    {
      qrCode: async ({ token, expires }) => {
        h.onQr(`tg://login?token=${toBase64Url(new Uint8Array(token))}`, expires)
      },
      password: async (hint) => {
        const pwd = await h.onPassword(hint, wrongPassword)
        wrongPassword = false
        return pwd
      },
      onError: async (err) => {
        if (isRpc(err, 'PASSWORD_HASH_INVALID')) {
          wrongPassword = true
          return false
        }
        fatal = err
        return true
      },
      abortSignal: h.signal,
    },
  ).catch((err) => {
    throw fatal ?? err
  })
  if (!(user instanceof Api.User)) throw new Error('Unexpected login result')
  return user
}

export async function logOut() {
  try {
    await getClient().invoke(new Api.auth.LogOut())
  } catch {
    /* the session may already be dead */
  }
}

export interface Me {
  id: string
  firstName: string
  lastName?: string
  username?: string
  premium: boolean
}

export async function fetchMe(): Promise<Me> {
  const me = await getClient().getMe()
  if (!(me instanceof Api.User)) throw new Error('Not a user account')
  return {
    id: me.id.toString(),
    firstName: me.firstName ?? '',
    lastName: me.lastName ?? undefined,
    username: me.username ?? undefined,
    premium: !!me.premium,
  }
}
