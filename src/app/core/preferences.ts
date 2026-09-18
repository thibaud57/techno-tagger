import { load } from "@tauri-apps/plugin-store"

import type { ExtractionMode } from "./models/protocol"

const STORE_FILE = "preferences.json"
const EXTRACTION_MODE_KEY = "extraction_mode"

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
