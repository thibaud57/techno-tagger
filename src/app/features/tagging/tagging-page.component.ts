import { Component, computed, inject, signal } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import {
  DangerConfirmComponent,
  injectDangerConfirm,
} from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { pickPath } from "../../shared/utils/dialog"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { progressPercentage } from "../../shared/utils/progress"
import { TOOLTIP_DELAY } from "../../shared/utils/tooltip"

import { RecoveryUiStore } from "./recovery-ui.store"
import { RunListComponent } from "./run-list.component"
import { UrlRecoveryDialogComponent } from "./url-recovery-dialog.component"

@Component({
  selector: "app-tagging-page",
  imports: [
    TranslatePipe,
    ButtonDirective,
    Tooltip,
    DangerConfirmComponent,
    MessageComponent,
    IconComponent,
    PathPickerComponent,
    PhaseProgressComponent,
    RollbackFailuresComponent,
    RunListComponent,
    EmptyStateComponent,
    ErrorMessageComponent,
    UrlRecoveryDialogComponent,
  ],
  templateUrl: "./tagging-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class TaggingPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly recoveryUi = inject(RecoveryUiStore)
  private readonly translate = inject(TranslateService)
  private readonly confirmDanger = injectDangerConfirm()

  protected readonly folder = signal("")
  protected readonly tooltipDelay = TOOLTIP_DELAY

  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  protected readonly committed = this.sidecar.committed
  protected readonly writing = this.sidecar.writing
  protected readonly writeProgress = this.sidecar.writeProgress
  protected readonly showsWriteBar = computed(() => this.writing() || this.writeProgress() !== null)
  protected readonly writePercentage = computed(() => progressPercentage(this.writeProgress()))
  /** Compte sur les lignes : un morceau restaure sort du message et de la relance. */
  protected readonly writeFailures = computed(
    () => this.tracks().filter((track) => track.state === "write_error").length,
  )
  /** Une ecriture ou une restauration tourne : le moteur n'en accepte qu'une a la fois. */
  protected readonly filesBusy = computed(
    () => this.writing() || this.sidecar.rollingBack() !== null,
  )
  /** Lignes que le dump peut rendre : ecrites, ou en echec dont les tags ont pu partir. */
  protected readonly restorableIds = computed<ReadonlySet<string>>(
    () =>
      new Set(
        this.committed()
          ? this.tracks()
              .filter((track) => track.state === "written" || track.state === "write_error")
              .map((track) => track.trackId)
          : [],
      ),
  )
  protected readonly canRestoreRun = computed(
    () => !this.writing() && this.restorableIds().size > 0,
  )
  /** Run affiche seulement : celui des Reglages ne fait pas tourner ce bouton. */
  protected readonly restoringRun = computed(() => {
    const inFlight = this.sidecar.rollingBack()

    return inFlight?.trackId === null && inFlight.runId === this.sidecar.taggingRunId()
  })
  protected readonly restoringTrackId = computed(() => this.sidecar.rollingBack()?.trackId ?? null)
  /** Le bilan ne vaut que pour le run qu'il nomme. */
  protected readonly runRollbackFailures = computed(() => {
    const finished = this.sidecar.rollbackFinished()

    return finished !== null && finished.run_id === this.sidecar.taggingRunId()
      ? finished.failed
      : []
  })
  /** Nul pendant le parcours du dossier : la liste s'affiche en squelette, jamais « aucun run ». */
  protected readonly listing = computed(() => this.sidecar.taggingRunId() === null)
  protected readonly showsRun = computed(
    () => this.running() || this.sidecar.taggingRunId() !== null,
  )
  protected readonly interrupted = this.sidecar.taggingInterrupted
  protected readonly idleDescription = computed(() =>
    this.folder() === "" ? "tagging.empty.description" : "tagging.empty.ready",
  )

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
    if (this.sidecar.rollingBack() !== null) {
      return "tagging.blocked.restoring"
    }
    // Un nouveau run fermerait la phase et couperait l'appel en vol : seule chose que le
    // lancement protege pendant la phase.
    if (this.sidecar.urlRecoveryBusy().size > 0) {
      return "tagging.blocked.recovering"
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
  protected readonly action = computed<"start" | "cancel" | "commit">(() => {
    if (this.running()) {
      return "cancel"
    }
    // Un autre dossier abandonne le run non ecrit ; le meme dossier le laisse confirmable.
    const unwritten =
      this.sidecar.taggingRunId() !== null &&
      !this.committed() &&
      this.folder() === this.sidecar.taggingFolder()

    return this.writing() || unwritten ? "commit" : "start"
  })
  /** Comptes lus sur les etats recus : l'interface ne decide rien de ce qui sera ecrit. */
  private readonly counts = computed(() => {
    const tracks = this.tracks()

    return {
      writable: tracks.filter((track) => track.state === "resolved").length,
      unresolved: tracks.filter((track) => track.state === "unresolved").length,
      awaiting: tracks.filter((track) => track.arbitration !== null).length,
    }
  })
  protected readonly commitBlockedReason = computed(() => {
    if (this.sidecar.rollingBack() !== null) {
      return "tagging.blocked.restoring"
    }
    if (this.writing()) {
      return "tagging.blocked.writing"
    }
    if (this.sidecar.urlRecoveryBusy().size > 0) {
      return "tagging.blocked.recovering"
    }
    if (this.sidecar.arbitrationInFlight()) {
      return "tagging.blocked.arbitrating"
    }
    if (this.counts().writable === 0) {
      return "tagging.blocked.nothingToWrite"
    }

    return null
  })
  protected readonly error = this.sidecar.errorFor(
    "start_tagging",
    "commit_run",
    "retry_write",
    "rollback",
  )
  protected readonly percentage = computed(() => progressPercentage(this.progress()))
  protected readonly recovery = this.sidecar.urlRecoveryProgress
  protected readonly recoveryPercentage = computed(() => progressPercentage(this.recovery()))
  protected readonly recoverableIds = computed(
    () => new Set(this.sidecar.recoverableTracks().map((track) => track.trackId)),
  )

  constructor() {
    void this.prefill()
  }

  protected async choose(): Promise<void> {
    const chosen = await pickPath({ directory: true })
    if (chosen !== null) {
      this.folder.set(chosen)
    }
  }

  protected async cancel(): Promise<void> {
    await this.sidecar.cancelTagging()
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) {
      return
    }
    await this.sidecar.startTagging(this.folder())
  }

  protected openArbitration(trackId: string): void {
    this.sidecar.openArbitration(trackId)
  }

  protected openRecovery(trackId: string): void {
    this.recoveryUi.open(trackId)
  }

  protected commit(): void {
    if (this.commitBlockedReason() !== null) {
      return
    }
    const { writable, unresolved, awaiting } = this.counts()
    const sentences = [
      this.t("tagging.commit.message", {
        folder: this.sidecar.taggingFolder() ?? "",
        count: writable,
      }),
      ...(unresolved > 0 ? [this.t("tagging.commit.unresolved", { count: unresolved })] : []),
      ...(awaiting > 0 ? [this.t("tagging.commit.awaiting", { count: awaiting })] : []),
    ]
    this.confirmDanger(
      "tagging.commit",
      sentences.join(" "),
      () => {
        void this.sidecar.commitRun()
      },
      false,
    )
  }

  protected retry(): void {
    this.confirmDanger(
      "tagging.retry",
      this.t("tagging.retry.message", { count: this.writeFailures() }),
      () => {
        void this.sidecar.retryWrite()
      },
      false,
    )
  }

  protected restoreRun(): void {
    const runId = this.sidecar.taggingRunId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.confirmRestore(this.restorableIds().size, () => this.sidecar.rollback(runId))
  }

  protected restoreTrack(trackId: string): void {
    const runId = this.sidecar.taggingRunId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.confirmRestore(1, () => this.sidecar.rollback(runId, trackId))
  }

  private confirmRestore(count: number, restore: () => Promise<void>): void {
    this.confirmDanger(
      "tagging.rollback",
      this.t("tagging.rollback.message", { count }),
      () => {
        void restore()
      },
      true,
    )
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string
  }

  private async prefill(): Promise<void> {
    // Page recreee : le run affiche prime sur la derniere destination.
    const runFolder = this.sidecar.taggingFolder()
    if (runFolder !== null) {
      this.folder.set(runFolder)

      return
    }
    const destination = await readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
}
