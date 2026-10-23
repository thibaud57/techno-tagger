import { Service } from "@angular/core"
import { load } from "@tauri-apps/plugin-store"

import { SCORE_SCALE, type ExtractionMode, type ThresholdsPayload } from "../sidecar/protocol"
import { LANGUAGES, type Language } from "../i18n/language"

const STORE_FILE = "preferences.json"

/**
 * Ne leve jamais : hors Tauri `load` rejette et une preference non enregistree n'est pas une
 * panne, donc defaut (l'interface reste utilisable sous `ng serve`). `accept` filtre la valeur
 * lue : un fichier edite a la main peut porter n'importe quoi sous une cle typee.
 */
const definePreference = <T>(
  key: string,
  fallback: T,
  accept: (stored: unknown) => stored is T,
) => ({
  read: async (): Promise<T> => {
    try {
      const store = await load(STORE_FILE)
      const stored = await store.get<unknown>(key)

      return accept(stored) ? stored : fallback
    } catch {
      return fallback
    }
  },
  write: async (value: T): Promise<void> => {
    try {
      const store = await load(STORE_FILE)
      await store.set(key, value)
      await store.save()
    } catch {
      return
    }
  },
})

/** Une valeur editee a la main hors de ces bornes ferait refuser `start_tagging`. */
export const isThresholds = (stored: unknown): stored is ThresholdsPayload => {
  if (typeof stored !== "object" || stored === null) {
    return false
  }
  const { floor, ceiling } = stored as Record<string, unknown>

  return (
    typeof floor === "number" &&
    typeof ceiling === "number" &&
    SCORE_SCALE.min <= floor &&
    floor <= ceiling &&
    ceiling <= SCORE_SCALE.max
  )
}

/** Notee avant l'installation : relance encore en `from`, elle a echoue. */
export interface UpdateAttempt {
  readonly from: string
  readonly to: string
}

const isUpdateAttempt = (stored: unknown): stored is UpdateAttempt => {
  if (typeof stored !== "object" || stored === null) {
    return false
  }
  const { from, to } = stored as Record<string, unknown>

  return typeof from === "string" && from !== "" && typeof to === "string" && to !== ""
}

/**
 * La copie est le defaut : la bibliotheque source reste intacte pendant que le
 * re-tagging reecrit les fichiers de destination.
 */
export const DEFAULT_EXTRACTION_MODE: ExtractionMode = "copy"
/** Actif par defaut : BRAINSTORM le decrit comme desactivable. */
export const DEFAULT_SOUND_SIGNAL = true

const extractionMode = definePreference<ExtractionMode>(
  "extraction_mode",
  DEFAULT_EXTRACTION_MODE,
  (stored): stored is ExtractionMode => stored === "copy" || stored === "move",
)
const soundSignal = definePreference<boolean>(
  "sound_signal",
  DEFAULT_SOUND_SIGNAL,
  (stored): stored is boolean => typeof stored === "boolean",
)
const lastDestination = definePreference<string | null>(
  "last_destination",
  null,
  (stored): stored is string => typeof stored === "string",
)
const language = definePreference<Language | null>("language", null, (stored): stored is Language =>
  LANGUAGES.some((known) => known === stored),
)
const thresholds = definePreference<ThresholdsPayload | null>("thresholds", null, isThresholds)
const updateAttempt = definePreference<UpdateAttempt | null>(
  "update_attempt",
  null,
  isUpdateAttempt,
)

/** Seul point d'entree du store Tauri de la webview : les specs le remplacent par `preferencesStub`. */
@Service()
export class PreferencesService {
  readExtractionMode(): Promise<ExtractionMode> {
    return extractionMode.read()
  }

  writeExtractionMode(value: ExtractionMode): Promise<void> {
    return extractionMode.write(value)
  }

  readSoundSignal(): Promise<boolean> {
    return soundSignal.read()
  }

  writeSoundSignal(value: boolean): Promise<void> {
    return soundSignal.write(value)
  }

  /** `null` tant que l'utilisateur n'a rien choisi : la locale systeme decide alors. */
  readLanguage(): Promise<Language | null> {
    return language.read()
  }

  writeLanguage(value: Language | null): Promise<void> {
    return language.write(value)
  }

  /** `null` : suivre les defauts du sidecar, aucun seuil n'est envoye. */
  readThresholds(): Promise<ThresholdsPayload | null> {
    return thresholds.read()
  }

  writeThresholds(value: ThresholdsPayload | null): Promise<void> {
    return thresholds.write(value)
  }

  readUpdateAttempt(): Promise<UpdateAttempt | null> {
    return updateAttempt.read()
  }

  writeUpdateAttempt(value: UpdateAttempt | null): Promise<void> {
    return updateAttempt.write(value)
  }

  /** Le dossier re-taggue est presque toujours la destination de la derniere extraction. */
  readLastDestination(): Promise<string | null> {
    return lastDestination.read()
  }

  writeLastDestination(value: string | null): Promise<void> {
    return lastDestination.write(value)
  }
}
