/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client id (Web), for Google Drive imports. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Google API key, used by the Picker. */
  readonly VITE_GOOGLE_API_KEY?: string
  /** Google Cloud project number, required by the Picker for drive.file. */
  readonly VITE_GOOGLE_APP_ID?: string
}
