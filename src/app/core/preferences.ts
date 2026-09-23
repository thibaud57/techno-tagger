import { load } from "@tauri-apps/plugin-store"

import type { ExtractionMode } from "./models/protocol"

const STORE_FILE = "preferences.json"
const EXTRACTION_MODE_KEY = "extraction_mode"
const SOUND_SIGNAL_KEY = "sound_signal"

/**
 * La copie est le defaut : la bibliotheque source reste intacte pendant que le
 * re-tagging reecrit les fichiers de destination.
 */
export const DEFAULT_EXTRACTION_MODE: ExtractionMode = "copy"

/**
 * Lit le mode retenu au dernier run.
 *
 * Hors Tauri, `load` rejette comme tout appel au plugin : le defaut s'applique
 * sans lever, l'interface devant rester utilisable sous le `ng serve` seul.
 */
export const readExtractionMode = async (): Promise<ExtractionMode> => {
  try {
    const store = await load(STORE_FILE)
    const stored = await store.get<ExtractionMode>(EXTRACTION_MODE_KEY)

    return stored === "move" ? "move" : DEFAULT_EXTRACTION_MODE
  } catch {
    return DEFAULT_EXTRACTION_MODE
  }
}

/** Une preference non enregistree n'est pas une panne : l'echec est silencieux. */
export const writeExtractionMode = async (mode: ExtractionMode): Promise<void> => {
  try {
    const store = await load(STORE_FILE)
    await store.set(EXTRACTION_MODE_KEY, mode)
    await store.save()
  } catch {
    return
  }
}

/** Le signal sonore est actif par defaut : BRAINSTORM le decrit comme desactivable. */
export const DEFAULT_SOUND_SIGNAL = true

export const readSoundSignal = async (): Promise<boolean> => {
  try {
    const store = await load(STORE_FILE)
    const stored = await store.get<boolean>(SOUND_SIGNAL_KEY)

    return stored ?? DEFAULT_SOUND_SIGNAL
  } catch {
    return DEFAULT_SOUND_SIGNAL
  }
}

/** Ecrit par les Reglages (Feature 7) ; une preference non enregistree n'est pas une panne. */
export const writeSoundSignal = async (enabled: boolean): Promise<void> => {
  try {
    const store = await load(STORE_FILE)
    await store.set(SOUND_SIGNAL_KEY, enabled)
    await store.save()
  } catch {
    return
  }
}

const LAST_DESTINATION_KEY = "last_destination"

/** Le dossier re-taggue est presque toujours la destination de la derniere extraction. */
export const readLastDestination = async (): Promise<string | null> => {
  try {
    const store = await load(STORE_FILE)

    return (await store.get<string>(LAST_DESTINATION_KEY)) ?? null
  } catch {
    return null
  }
}

export const writeLastDestination = async (folder: string): Promise<void> => {
  try {
    const store = await load(STORE_FILE)
    await store.set(LAST_DESTINATION_KEY, folder)
    await store.save()
  } catch {
    return
  }
}
