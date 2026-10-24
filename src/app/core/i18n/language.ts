import { locale } from "@tauri-apps/plugin-os"

import { withFallback } from "../platform/tauri-fallback"

export const LANGUAGES = ["fr", "en"] as const

export type Language = (typeof LANGUAGES)[number]

export const FALLBACK_LANGUAGE: Language = "en"

/** Compare le prefixe du tag BCP-47 : `fr`, `fr-BE` et `fr-Latn-FR` donnent tous le francais. */
export const languageFromTag = (tag: string | null | undefined): Language =>
  tag?.toLowerCase().startsWith("fr") ? "fr" : FALLBACK_LANGUAGE

/**
 * Locale systeme, puis navigateur, puis anglais.
 *
 * Le navigateur couvre `just dev-ui` : hors Tauri, `invoke()` lit `window.__TAURI_INTERNALS__`
 * sans garde et rejette avec une `TypeError`. Dans Tauri, un rejet est une vraie panne : il remonte.
 */
export const resolveInitialLanguage = async (
  readSystemLocale: () => Promise<string | null> = locale,
  readBrowserLanguage: () => string = () => navigator.language,
): Promise<Language> => {
  const systemLocale = await withFallback(readSystemLocale, null)
  if (systemLocale) {
    return languageFromTag(systemLocale)
  }

  return languageFromTag(readBrowserLanguage())
}

/**
 * Le choix pose dans les Reglages, sinon la locale : il prime aux lancements suivants.
 * `readStored` est fourni par l'appelant : `preferences.service.ts` importe deja ce module.
 */
export const resolveStartupLanguage = async (
  readStored: () => Promise<Language | null>,
  resolveSystem: () => Promise<Language> = resolveInitialLanguage,
): Promise<Language> => (await readStored()) ?? (await resolveSystem())
