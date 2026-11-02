/* Minimal typings for the parts of Google Identity Services and Google Picker that TeleDriver uses. */

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string
    expires_in: number
    scope: string
    error?: string
    error_description?: string
  }
  interface TokenClientConfig {
    client_id: string
    scope: string
    include_granted_scopes?: boolean
    prompt?: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type: string; message?: string }) => void
  }
  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: string; scope?: string }): void
  }
  function initTokenClient(config: TokenClientConfig): TokenClient
  function revoke(accessToken: string, done?: () => void): void
}

declare namespace google.picker {
  const ViewId: { DOCS: string; FOLDERS: string }
  const Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string }
  const Action: { PICKED: string; CANCEL: string }
  class DocsView {
    constructor(viewId?: string)
    setIncludeFolders(include: boolean): DocsView
    setSelectFolderEnabled(enabled: boolean): DocsView
    setMimeTypes(mimeTypes: string): DocsView
    setEnableDrives(enabled: boolean): DocsView
  }
  interface PickerDocument {
    id: string
    name: string
    mimeType: string
    sizeBytes?: number
  }
  interface ResponseObject {
    action: string
    docs?: PickerDocument[]
  }
  interface Picker {
    setVisible(visible: boolean): void
    dispose(): void
  }
  class PickerBuilder {
    addView(view: DocsView): PickerBuilder
    setOAuthToken(token: string): PickerBuilder
    setDeveloperKey(key: string): PickerBuilder
    setAppId(appId: string): PickerBuilder
    setOrigin(origin: string): PickerBuilder
    setLocale(locale: string): PickerBuilder
    setTitle(title: string): PickerBuilder
    enableFeature(feature: string): PickerBuilder
    setCallback(callback: (data: ResponseObject) => void): PickerBuilder
    build(): Picker
  }
}

declare const gapi: {
  load(name: string, options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void
}
