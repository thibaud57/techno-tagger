import { Component, computed, inject, signal } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { CompletionSignalService } from "../../core/completion-signal.service"
import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { pickPath } from "../../shared/utils/dialog"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { TOOLTIP_DELAY } from "../../shared/utils/tooltip"

import { RunListComponent } from "./run-list.component"

@Component({
  selector: "app-tagging-page",
  imports: [
    TranslatePipe,
    ButtonDirective,
    Tooltip,
    IconComponent,
    PathPickerComponent,
    PhaseProgressComponent,
    RunListComponent,
    EmptyStateComponent,
    ErrorMessageComponent,
  ],
  templateUrl: "./tagging-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class TaggingPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly completion = inject(CompletionSignalService)

  protected readonly folder = signal("")
  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  protected readonly tooltipDelay = TOOLTIP_DELAY

  /**
   * Source unique de l'action et de son aide : le tooltip d'un bouton desactive
   * nomme ce qui manque, seule exception admise. Ordre de priorite, du plus proche
   * de l'utilisateur au plus lointain : run en cours, cle API manquante, dossier
   * manquant, sidecar indisponible.
   *
   * `ready()` mele plusieurs causes (sidecar non disponible, version pas encore
   * recue, divergence de version, extraction en cours sur l'onglet Playlist) :
   * les trois premieres bloquent deja tout l'app via l'ecran bloquant de
   * `app.component.html` (les onglets n'y sont meme pas rendus), seule
   * l'extraction est observable depuis cet ecran-ci et merite un libelle propre.
   */
  protected readonly blockedReason = computed(() => {
    if (this.sidecar.tagging()) {
      return "tagging.blocked.running"
    }
    if (this.sidecar.apiKeyConfigured() !== true) {
      return "tagging.blocked.api_key"
    }
    if (this.folder() === "") {
      return "tagging.blocked.folder"
    }
    if (this.sidecar.ready() !== true) {
      return this.sidecar.extracting() ? "tagging.blocked.extracting" : "tagging.blocked.sidecar"
    }

    return null
  })
  protected readonly canStart = computed(() => this.blockedReason() === null)
  /** Un ecran n'affiche que les erreurs de la commande qu'il emet. */
  protected readonly error = computed(() =>
    this.sidecar.lastErrorCommand() === "start_tagging" ? this.sidecar.lastError() : null,
  )
  protected readonly percentage = computed(() => {
    const progress = this.progress()

    return progress === null || progress.total === 0
      ? undefined
      : Math.round((progress.processed / progress.total) * 100)
  })

  constructor() {
    void this.prefill()
    this.completion.announceOnTransition(this.sidecar.taggingFinished, "tagging.finished")
  }

  protected async choose(): Promise<void> {
    const chosen = await pickPath({ directory: true })
    if (chosen !== null) {
      this.folder.set(chosen)
    }
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) {
      return
    }
    await this.sidecar.startTagging(this.folder())
  }

  private async prefill(): Promise<void> {
    const destination = await readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
}
