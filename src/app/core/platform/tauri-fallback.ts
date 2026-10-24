import { isTauri } from "@tauri-apps/api/core"

/**
 * Hors Tauri (`ng serve`, specs), les API natives rejettent faute de `__TAURI_INTERNALS__` :
 * le repli est attendu. Dans Tauri, l'echec est reel (store corrompu, disque plein) : signale
 * au gestionnaire global, donc a Sentry, sans casser l'ecran qui garde son repli.
 */
export const withFallback = async <T>(call: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await call()
  } catch (error) {
    if (isTauri()) {
      reportError(error)
    }
    return fallback
  }
}
