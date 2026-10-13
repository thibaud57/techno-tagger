import { locale } from "@tauri-apps/plugin-os"

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
 * sans garde et rejette avec une `TypeError`.
 */
export const resolveInitialLanguage = async (
  readSystemLocale: () => Promise<string | null> = locale,
  readBrowserLanguage: () => string = () => navigator.language,
): Promise<Language> => {
  try {
    const systemLocale = await readSystemLocale()
    if (systemLocale) {
      return languageFromTag(systemLocale)
    }
  } catch {
    // Repli attendu hors Tauri, pas une panne.
  }

  return languageFromTag(readBrowserLanguage())
}
