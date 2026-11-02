import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { vi } from './locales/vi'

export const LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
const STORAGE_KEY = 'td-lang'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, vi: { translation: vi } },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    // Only an explicit choice is remembered; otherwise follow the system language.
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: STORAGE_KEY, caches: [] },
  })

if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (lng) => document.documentElement.setAttribute('lang', lng))
  document.documentElement.setAttribute('lang', i18n.resolvedLanguage ?? i18n.language)
}

/** `auto` forgets the explicit choice and goes back to the browser language. */
export function setLanguage(lng: Language | 'auto') {
  try {
    if (lng === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* storage unavailable */
  }
  if (lng === 'auto') {
    const nav = navigator.languages?.[0] ?? navigator.language ?? 'en'
    void i18n.changeLanguage(nav.toLowerCase().startsWith('vi') ? 'vi' : 'en')
  } else void i18n.changeLanguage(lng)
}

export function languagePreference(): Language | 'auto' {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'vi' || v === 'en' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export default i18n
