import { InjectionToken } from "@angular/core"
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater"

/** Octets recus depuis le debut ; `total` est nul quand le serveur ne l'annonce pas. */
export interface DownloadProgress {
  readonly received: number
  readonly total: number | null
}

/** L'objet `Update` du plugin, reduit a ce que l'application emploie. */
export interface AvailableUpdate {
  readonly version: string
  readonly currentVersion: string
  /** `null` quand l'url du manifeste ne designe pas une Release GitHub. */
  readonly releasePage: string | null
  downloadAndInstall(onProgress: (progress: DownloadProgress) => void): Promise<void>
  /** Sans quoi le plugin garde la ressource cote Rust jusqu'a la sortie. */
  close(): Promise<void>
}

export interface AppUpdater {
  check(): Promise<AvailableUpdate | null>
}

// Sans borne, une verification pendue bloquerait « Reessayer » sur une modale non fermable.
const CHECK_TIMEOUT_MS = 30_000

const RELEASE_DOWNLOAD =
  /^(https:\/\/github\.com\/[^/]+\/[^/]+\/releases)\/download\/([^/]+)\/[^/]+$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** `.../releases/download/<tag>/<installeur>` donne `.../releases/tag/<tag>` : aucune adresse du depot en TypeScript. */
export const releasePageOf = (manifest: Record<string, unknown>): string | null => {
  const platforms = manifest["platforms"]
  const windows = isRecord(platforms) ? platforms["windows-x86_64"] : undefined
  const url = isRecord(windows) ? windows["url"] : undefined
  const [, releases, tag] = (typeof url === "string" ? RELEASE_DOWNLOAD.exec(url) : null) ?? []

  return releases && tag ? `${releases}/tag/${tag}` : null
}

/** `chunkLength` est un delta : le cumul est a notre charge. */
export const progressAfter = (
  progress: DownloadProgress,
  event: DownloadEvent,
): DownloadProgress => {
  switch (event.event) {
    case "Started":
      return { received: 0, total: event.data.contentLength ?? null }
    case "Progress":
      return { ...progress, received: progress.received + event.data.chunkLength }
    case "Finished":
      return progress
    default: {
      // Levee dans le callback du canal, une erreur figerait la barre sans arreter le telechargement.
      const exhaustive: never = event
      console.error("[updater] evenement de telechargement non traite", exhaustive)
      return progress
    }
  }
}

class TauriAppUpdater implements AppUpdater {
  // Leve hors Tauri : l'appelant le traite comme une verification en echec.
  async check(): Promise<AvailableUpdate | null> {
    const update = await check({ timeout: CHECK_TIMEOUT_MS })
    if (update === null) {
      return null
    }

    return {
      version: update.version,
      currentVersion: update.currentVersion,
      releasePage: releasePageOf(update.rawJson),
      downloadAndInstall: async (onProgress) => {
        let progress: DownloadProgress = { received: 0, total: null }
        // Sous Windows, l'application sort a l'installation : rien ne s'execute apres.
        await update.downloadAndInstall((event) => {
          progress = progressAfter(progress, event)
          onProgress(progress)
        })
      },
      close: () => update.close(),
    }
  }
}

export const APP_UPDATER = new InjectionToken<AppUpdater>("AppUpdater", {
  providedIn: "root",
  factory: () => new TauriAppUpdater(),
})
