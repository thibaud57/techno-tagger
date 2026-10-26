import { Service } from "@angular/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

import { withFallback } from "./tauri-fallback"

export type PathTarget = "library" | "destination" | "playlist" | "tagging_folder"

/** Seul point d'entree des plugins `dialog` et `opener` et des URL d'asset : les specs le remplacent par `nativeStub`. */
@Service()
export class NativeService {
  /** `null` : annulation (le plugin la signale par `null`, pas par une erreur) ou hors Tauri. */
  async pickPath(target: PathTarget): Promise<string | null> {
    const chosen = await withFallback(
      () => open({ directory: target !== "playlist", multiple: false }),
      null,
    )

    return typeof chosen === "string" ? chosen : null
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
