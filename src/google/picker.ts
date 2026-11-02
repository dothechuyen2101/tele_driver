import i18n from '@/i18n'
import { googleConfig, loadScript } from './auth'
import { FOLDER_MIME } from './drive'

export interface PickedDoc {
  id: string
  name: string
  mimeType: string
  size?: number
}

let pickerLoaded: Promise<void> | null = null

/** Loads gapi + the Picker module (call early, e.g. when the Google tab opens). */
export function preloadPicker() {
  if (!pickerLoaded) {
    pickerLoaded = loadScript('https://apis.google.com/js/api.js').then(
      () =>
        new Promise<void>((resolve, reject) =>
          gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('GOOGLE_SCRIPT_FAILED')), timeout: 20_000, ontimeout: () => reject(new Error('GOOGLE_SCRIPT_FAILED')) }),
        ),
    )
    pickerLoaded.catch(() => {
      pickerLoaded = null
    })
  }
  return pickerLoaded
}

/** Shows Google's file picker; resolves with the chosen items (empty when cancelled). */
export async function pick(token: string, mode: 'files' | 'folder'): Promise<PickedDoc[]> {
  const cfg = googleConfig()
  if (!cfg) throw new Error('GOOGLE_NOT_CONFIGURED')
  await preloadPicker()
  return new Promise<PickedDoc[]>((resolve) => {
    const view =
      mode === 'folder'
        ? new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME)
        : new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false)
    view.setEnableDrives(true)
    let builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setOrigin(location.origin)
      .setLocale(i18n.language)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve((data.docs ?? []).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType, size: d.sizeBytes })))
          picker.dispose()
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([])
          picker.dispose()
        }
      })
    if (mode === 'files') builder = builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
    const picker = builder.build()
    picker.setVisible(true)
  })
}
