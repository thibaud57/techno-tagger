import { Component, computed, inject, signal } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { readLastDestination } from "../../core/preferences"
import { SidecarService, type RunAction } from "../../core/sidecar.service"
import {
  DangerConfirmComponent,
  injectDangerConfirm,
} from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent, type IconName } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { pickPath } from "../../shared/utils/dialog"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { progressPercentage } from "../../shared/utils/progress"
import { TOOLTIP } from "../../shared/utils/tooltip"

import { RecoveryUiStore } from "./recovery-ui.store"
import { RunListComponent } from "./run-list.component"
import { UrlRecoveryDialogComponent } from "./url-recovery-dialog.component"

interface ActionButton {
  readonly action: RunAction
  /** Cle de traduction du libelle. */
  readonly label: string
  readonly icon: IconName
  /** « Interrompre » seul : rien n'est irreversible avant l'ecriture, aucun accent. */
  readonly secondary: boolean
  /** Cle de traduction de ce qui bloque le bouton, `null` s'il est actif. */
  readonly blocked: string | null
  readonly run: () => void
}

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
  protected readonly tooltip = TOOLTIP

  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  protected readonly committed = this.sidecar.committed
  protected readonly runFrozen = this.sidecar.runFrozen
  protected readonly writing = this.sidecar.writing
  protected readonly writeProgress = this.sidecar.writeProgress
  protected readonly showsWriteBar = computed(() => this.writing() || this.writeProgress() !== null)
  protected readonly writePercentage = computed(() => progressPercentage(this.writeProgress()))
  /** Compte sur les lignes : un morceau restaure sort du message et de la relance. */
  protected readonly writeFailures = this.sidecar.writeFailureCount
  protected readonly filesBusy = this.sidecar.filesBusy
  /** Lignes que le dump peut rendre : le sidecar le dit par ligne, l'interface ne le deduit pas de l'etat. */
  protected readonly restorableIds = computed<ReadonlySet<string>>(
    () =>
      new Set(
        this.tracks()
          .filter((track) => track.restorable)
          .map((track) => track.trackId),
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
   * Aide du bouton quand l'action est `start`, priorisee du plus proche de l'utilisateur au
   * plus lointain. `ready()` mele plusieurs causes, mais toutes sauf l'extraction bloquent
   * deja l'app entiere par son ecran bloquant : seule celle-ci merite un libelle ici.
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
  protected readonly action = this.sidecar.runAction(this.folder)
  /**
   * Comptes lus sur les etats recus : l'interface ne decide rien de ce qui sera ecrit. Les
   * attentes se comptent sur les lignes, la file d'arbitrage pouvant en retirer une que sa
   * ligne porte encore (`arbitration_not_pending`).
   */
  private readonly counts = computed(() => ({
    writable: this.sidecar.taggingWritableCount(),
    awaiting: this.tracks().filter((track) => track.arbitration !== null).length,
  }))
  protected readonly writeBlockedReason = computed(() => {
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

    return null
  })
  /** Un seul bouton d'action : libelle, icone, raison de blocage et geste suivent l'action. */
  protected readonly actionButton = computed<ActionButton>(() => {
    const action = this.action()
    const write = (label: string, idle: IconName, run: () => void): ActionButton => ({
      action,
      label,
      icon: this.writing() ? "spinner" : idle,
      secondary: false,
      blocked: this.writeBlockedReason(),
      run,
    })
    switch (action) {
      case "cancel":
        return {
          action,
          label: "tagging.cancel",
          icon: "stop",
          secondary: true,
          blocked: null,
          run: () => void this.cancel(),
        }
      case "commit":
        return write("tagging.commit.action", "check", () => {
          this.commit()
        })
      case "retry":
        return write("tagging.retry.action", "refresh", () => {
          this.retry()
        })
      case "start":
        return {
          action,
          label: "tagging.start",
          icon: "play",
          secondary: false,
          blocked: this.blockedReason(),
          run: () => void this.start(),
        }
    }
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
    if (this.blockedReason() !== null) {
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
    if (this.writeBlockedReason() !== null) {
      return
    }
    const { writable, awaiting } = this.counts()
    const unresolved = this.recoveryUi.unresolvedCount()
    // Une ligne par compte, la garantie de restauration en bloc separe : la modale s'aere.
    const counts = [
      this.t("tagging.commit.message", {
        folder: this.sidecar.taggingFolder() ?? "",
        count: writable,
      }),
      ...(unresolved > 0 ? [this.t("tagging.commit.unresolved", { count: unresolved })] : []),
      ...(awaiting > 0 ? [this.t("tagging.commit.awaiting", { count: awaiting })] : []),
    ]
    this.confirmDanger(
      "tagging.commit",
      `${counts.join("\n")}\n\n${this.t("tagging.commit.backup")}`,
      () => {
        void this.sidecar.commitRun()
      },
      false,
    )
  }

  protected retry(): void {
    if (this.writeBlockedReason() !== null) {
      return
    }
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
    this.restore(this.restorableIds().size)
  }

  protected restoreTrack(trackId: string): void {
    this.restore(1, trackId)
  }

  /** Sans `trackId`, tout le run. */
  private restore(count: number, ...trackId: [] | [string]): void {
    const runId = this.sidecar.taggingRunId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.confirmDanger(
      "tagging.rollback",
      this.t("tagging.rollback.message", { count }),
      () => {
        void this.sidecar.rollback(runId, ...trackId)
      },
      true,
    )
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string
  }

  private async prefill(): Promise<void> {
    // Page recreee : le run affiche prime sur la derniere destination, sous la forme demandee
    // (celle que compare `action`), pas sous celle que le sidecar a normalisee.
    const runFolder = this.sidecar.requestedFolder()
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
