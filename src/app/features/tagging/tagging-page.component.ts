import { Component, computed, inject, signal } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { pickPath } from "../../shared/utils/dialog"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { progressPercentage } from "../../shared/utils/progress"
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

  protected readonly folder = signal("")
  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  /** Nul pendant le parcours du dossier : la liste s'affiche en squelette, jamais « aucun run ». */
  protected readonly listing = computed(() => this.sidecar.taggingRunId() === null)
  protected readonly showsRun = computed(() => this.running() || !this.listing())
  protected readonly interrupted = this.sidecar.taggingInterrupted
  protected readonly idleDescription = computed(() =>
    this.folder() === "" ? "tagging.empty.description" : "tagging.empty.ready",
  )
  protected readonly tooltipDelay = TOOLTIP_DELAY

  /**
   * Seule source de l'aide du bouton desactive, priorisee du plus proche de
   * l'utilisateur au plus lointain.
   *
   * `ready()` mele plusieurs causes, mais toutes sauf l'extraction bloquent deja
   * l'app entiere par son ecran bloquant : seule celle-ci merite un libelle ici.
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
  protected readonly error = this.sidecar.errorFor("start_tagging")
  protected readonly percentage = computed(() => progressPercentage(this.progress()))

  constructor() {
    void this.prefill()
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
