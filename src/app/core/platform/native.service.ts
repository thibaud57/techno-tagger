import { Service } from "@angular/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

/** Seul point d'entree des plugins `dialog` et `opener` et des URL d'asset : les specs le remplacent par `nativeStub`. */
@Service()
export class NativeService {
  /** Hors Tauri, le plugin `dialog` rejette : l'ecran reste utilisable. */
  async pickPath(options: { directory: boolean }): Promise<string | null> {
    try {
      const chosen = await open({ directory: options.directory, multiple: false })

      return typeof chosen === "string" ? chosen : null
    } catch {
      return null
    }
  }

  openUrl(url: string): Promise<void> {
    return openUrl(url)
  }

  revealItemInDir(path: string): Promise<void> {
    return revealItemInDir(path)
  }

  /** `convertFileSrc` n'existe pas hors Tauri. */
  assetUrl(path: string): string {
    return convertFileSrc(path)
  }
}
