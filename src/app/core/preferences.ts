import { load } from "@tauri-apps/plugin-store"

import type { ExtractionMode } from "./models/protocol"

const STORE_FILE = "preferences.json"

/**
 * Une preference : sa lecture rend toujours une valeur, son ecriture n'echoue jamais.
 *
 * Hors Tauri, `load` rejette comme tout appel au plugin, et une preference non
 * enregistree n'est pas une panne : les deux cas retombent silencieusement sur le
 * defaut, l'interface devant rester utilisable sous le `ng serve` seul.
 *
 * `accept` filtre ce que le store rend : un fichier edite a la main ou ecrit par une
 * version anterieure peut porter n'importe quoi sous une cle typee.
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

/**
 * La copie est le defaut : la bibliotheque source reste intacte pendant que le
 * re-tagging reecrit les fichiers de destination.
 */
export const DEFAULT_EXTRACTION_MODE: ExtractionMode = "copy"
/** Le signal sonore est actif par defaut : BRAINSTORM le decrit comme desactivable. */
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

/** Lit le mode retenu au dernier run. */
export const readExtractionMode = extractionMode.read
export const writeExtractionMode = extractionMode.write

export const readSoundSignal = soundSignal.read
/** Ecrit par les Reglages (Feature 7). */
export const writeSoundSignal = soundSignal.write

/** Le dossier re-taggue est presque toujours la destination de la derniere extraction. */
export const readLastDestination = lastDestination.read
export const writeLastDestination = lastDestination.write
