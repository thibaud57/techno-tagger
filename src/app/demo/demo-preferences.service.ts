import { Service } from "@angular/core"

import { LANGUAGES, type Language } from "../core/i18n/language"
import {
  DEFAULT_EXTRACTION_MODE,
  DEFAULT_SOUND_SIGNAL,
  isThresholds,
  isUpdateAttempt,
  type PreferencesService,
  type UpdateAttempt,
} from "../core/platform/preferences.service"
import type { ExtractionMode, ThresholdsPayload } from "../core/sidecar/protocol"
import { takeLanguageFromQuery } from "./demo-language"

const KEY_PREFIX = "techno-tagger-demo:"

/** Meme garde que le desktop : une valeur illisible ou hors type retombe sur le defaut. */
const parseStored = <T>(
  raw: string | null,
  fallback: T,
  accept: (stored: unknown) => stored is T,
): T => {
  if (raw === null) {
    return fallback
  }

  try {
    const stored: unknown = JSON.parse(raw)

    return accept(stored) ? stored : fallback
  } catch (error) {
    // Seule une valeur editee a la main est toleree ; toute autre erreur est un bug du code.
    if (error instanceof SyntaxError) {
      return fallback
    }
    throw error
  }
}

/** Les reglages de la demo vivent dans `localStorage`, sous un prefixe qui les isole du reste de l'origine. */
@Service({ autoProvided: false })
export class DemoPreferencesService implements PreferencesService {
  private readonly memory = new Map<string, string>()

  readExtractionMode(): Promise<ExtractionMode> {
    return Promise.resolve(
      parseStored(
        this.get("extraction_mode"),
        DEFAULT_EXTRACTION_MODE,
        (stored): stored is ExtractionMode => stored === "copy" || stored === "move",
      ),
    )
  }

  writeExtractionMode(value: ExtractionMode): Promise<void> {
    return this.set("extraction_mode", value)
  }

  readSoundSignal(): Promise<boolean> {
    return Promise.resolve(
      parseStored(
        this.get("sound_signal"),
        DEFAULT_SOUND_SIGNAL,
        (stored): stored is boolean => typeof stored === "boolean",
      ),
    )
  }

  writeSoundSignal(value: boolean): Promise<void> {
    return this.set("sound_signal", value)
  }

  async readLanguage(): Promise<Language | null> {
    const fromQuery = takeLanguageFromQuery(window.location, window.history)
    if (fromQuery !== null) {
      await this.writeLanguage(fromQuery)

      return fromQuery
    }

    return parseStored<Language | null>(this.get("language"), null, (stored): stored is Language =>
      LANGUAGES.some((known) => known === stored),
    )
  }

  writeLanguage(value: Language | null): Promise<void> {
    return this.set("language", value)
  }

  readThresholds(): Promise<ThresholdsPayload | null> {
    return Promise.resolve(
      parseStored<ThresholdsPayload | null>(this.get("thresholds"), null, isThresholds),
    )
  }

  writeThresholds(value: ThresholdsPayload | null): Promise<void> {
    return this.set("thresholds", value)
  }

  readUpdateAttempt(): Promise<UpdateAttempt | null> {
    return Promise.resolve(
      parseStored<UpdateAttempt | null>(this.get("update_attempt"), null, isUpdateAttempt),
    )
  }

  writeUpdateAttempt(value: UpdateAttempt | null): Promise<void> {
    return this.set("update_attempt", value)
  }

  readLastDestination(): Promise<string | null> {
    return Promise.resolve(
      parseStored<string | null>(
        this.get("last_destination"),
        null,
        (stored): stored is string => typeof stored === "string",
      ),
    )
  }

  writeLastDestination(value: string | null): Promise<void> {
    return this.set("last_destination", value)
  }

  private get(key: string): string | null {
    const prefixed = KEY_PREFIX + key
    const kept = this.memory.get(prefixed)
    if (kept !== undefined) {
      return kept
    }

    try {
      return localStorage.getItem(prefixed)
    } catch (error) {
      // Navigation privee ou cookies bloques : le navigateur leve une DOMException. Toute
      // autre erreur est un bug du code et doit remonter.
      if (error instanceof DOMException) {
        return null
      }
      throw error
    }
  }

  private set(key: string, value: unknown): Promise<void> {
    const prefixed = KEY_PREFIX + key
    const serialized = JSON.stringify(value)

    try {
      localStorage.setItem(prefixed, serialized)
      this.memory.delete(prefixed)
    } catch (error) {
      // Stockage refuse ou plein : la visite continue avec une copie en memoire. Toute autre
      // erreur est un bug du code et doit remonter.
      if (!(error instanceof DOMException)) {
        throw error
      }
      this.memory.set(prefixed, serialized)
    }

    return Promise.resolve()
  }
}
