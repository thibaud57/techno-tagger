import { Service, inject } from "@angular/core"

import type { NativeService, PathTarget } from "../core/platform/native.service"
import { DemoScenarioService } from "./demo-scenario.service"

/** Aucun selecteur en demo : chaque cible rend le chemin que le scenario a enregistre. */
@Service({ autoProvided: false })
export class DemoNativeService implements NativeService {
  private readonly scenario = inject(DemoScenarioService)

  pickPath(target: PathTarget): Promise<string | null> {
    const { library, destination, vlc_dump } = this.scenario.scenario().paths
    const paths = {
      library,
      destination,
      tagging_folder: destination,
      playlist: vlc_dump,
    } satisfies Record<PathTarget, string>

    return Promise.resolve(paths[target])
  }

  // Les appelants sont grises en demo (aucune navigation ni explorateur hors du navigateur).
  openUrl(): Promise<void> {
    return Promise.resolve()
  }

  revealItemInDir(): Promise<void> {
    return Promise.resolve()
  }

  assetUrl(path: string): string {
    return `/demo/${path}`
  }
}
