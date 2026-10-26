import { Service } from "@angular/core"

import type { Language } from "../core/i18n/language"
import {
  PREFERENCES,
  type Preference,
  type PreferencesService,
  type UpdateAttempt,
} from "../core/platform/preferences.service"
import type { ExtractionMode, ThresholdsPayload } from "../core/sidecar/protocol"
import { takeLanguageFromQuery } from "./demo-language"

const KEY_PREFIX = "techno-tagger-demo:"

/** Meme garde que le desktop : une valeur illisible ou hors type retombe sur le defaut. */
const parseStored = <T>(raw: string | null, { fallback, accept }: Preference<T>): T => {
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
    return this.read(PREFERENCES.extractionMode)
  }

  writeExtractionMode(value: ExtractionMode): Promise<void> {
    return this.write(PREFERENCES.extractionMode, value)
  }

  readSoundSignal(): Promise<boolean> {
    return this.read(PREFERENCES.soundSignal)
  }

  writeSoundSignal(value: boolean): Promise<void> {
    return this.write(PREFERENCES.soundSignal, value)
  }

  async readLanguage(): Promise<Language | null> {
    const fromQuery = takeLanguageFromQuery(window.location, window.history)
    if (fromQuery !== null) {
      await this.writeLanguage(fromQuery)

      return fromQuery
    }

    return this.read(PREFERENCES.language)
  }

  writeLanguage(value: Language | null): Promise<void> {
    return this.write(PREFERENCES.language, value)
  }

  readThresholds(): Promise<ThresholdsPayload | null> {
    return this.read(PREFERENCES.thresholds)
  }

  writeThresholds(value: ThresholdsPayload | null): Promise<void> {
    return this.write(PREFERENCES.thresholds, value)
  }

  readUpdateAttempt(): Promise<UpdateAttempt | null> {
    return this.read(PREFERENCES.updateAttempt)
  }

  writeUpdateAttempt(value: UpdateAttempt | null): Promise<void> {
    return this.write(PREFERENCES.updateAttempt, value)
  }

  readLastDestination(): Promise<string | null> {
    return this.read(PREFERENCES.lastDestination)
  }

  writeLastDestination(value: string | null): Promise<void> {
    return this.write(PREFERENCES.lastDestination, value)
  }

  private read<T>(preference: Preference<T>): Promise<T> {
    return Promise.resolve(parseStored(this.get(preference.key), preference))
  }

  private write<T>({ key }: Preference<T>, value: T): Promise<void> {
    return this.set(key, value)
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
