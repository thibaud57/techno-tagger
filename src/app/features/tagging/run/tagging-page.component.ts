import { Component, computed, inject, linkedSignal } from "@angular/core"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { NativeService } from "../../../core/platform/native.service"
import { PreferencesService } from "../../../core/platform/preferences.service"
import { errorRunId, errorTrackId } from "../../../core/sidecar/error-params"
import type { SidecarErrorEvent } from "../../../core/sidecar/protocol"
import { SidecarService, type RunAction } from "../../../core/sidecar/sidecar.service"
import {
  DangerConfirmComponent,
  injectDangerConfirm,
} from "../../../shared/components/dialogs/danger-confirm.component"
import { RollbackFailuresComponent } from "../../../shared/components/dialogs/rollback-failures.component"
import { EmptyStateComponent } from "../../../shared/components/display/empty-state.component"
import { IconComponent, type IconName } from "../../../shared/components/display/icon.component"
import { PhaseProgressComponent } from "../../../shared/components/display/phase-progress.component"
import { ErrorMessageComponent } from "../../../shared/components/feedback/error-message.component"
import { MessageComponent } from "../../../shared/components/feedback/message.component"
import { PathPickerComponent } from "../../../shared/components/inputs/path-picker.component"
import { FADE_IN } from "../../../shared/utils/motion"
import { progressPercentage } from "../../../shared/utils/progress"
import { TOOLTIP } from "../../../shared/utils/tooltip"

import { RecoveryUiStore } from "../url-recovery/recovery-ui.store"
import { UrlRecoveryDialogComponent } from "../url-recovery/url-recovery-dialog.component"
import { RunListComponent } from "./run-list.component"
import { injectRunRestore } from "./run-restore"

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
  host: { class: "page-host", "animate.enter": FADE_IN },
})
export default class TaggingPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly recoveryUi = inject(RecoveryUiStore)
  private readonly translate = inject(TranslateService)
  private readonly router = inject(Router)
  private readonly native = inject(NativeService)
  private readonly preferences = inject(PreferencesService)
  private readonly confirmDanger = injectDangerConfirm()
  protected readonly runRestore = injectRunRestore()

  /**
   * Dossier du champ : celui du run affiche (`requestedFolder`, la forme que compare `action`).
   * Une reprise le pose pendant que la page est montee et le champ le suit.
   */
  protected readonly folder = linkedSignal<string | null, string>({
    source: this.sidecar.requestedFolder,
    computation: (requested, previous) => requested ?? previous?.value ?? "",
  })
  protected readonly tooltip = TOOLTIP

  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  protected readonly committed = this.sidecar.committed
  protected readonly runFrozen = this.sidecar.runFrozen
  protected readonly writing = this.sidecar.writing
  protected readonly writeProgress = this.sidecar.writeProgress
  protected readonly recapAvailable = computed(() => this.sidecar.writeFinished() !== null)
  protected readonly showsWriteBar = computed(() => this.writing() || this.writeProgress() !== null)
  protected readonly writePercentage = computed(() => progressPercentage(this.writeProgress()))
  /** Compte sur les lignes : un morceau restaure sort du message et de la relance. */
  protected readonly writeFailures = this.sidecar.writeFailureCount
  protected readonly filesBusy = this.sidecar.filesBusy
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
   * plus lointain. `ready()` mele plusieurs causes : l'ecran bloquant couvre deja un moteur absent
   * ou en conflit de version, il ne reste que l'extraction et le demarrage du moteur.
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
    if (!this.sidecar.ready()) {
      return this.sidecar.extracting() ? "tagging.blocked.extracting" : "tagging.blocked.sidecar"
    }

    return null
  })
  protected readonly action = this.sidecar.runAction(this.folder)
  /**
   * Comptes lus sur les etats recus : l'interface ne decide rien de ce qui sera ecrit. Les
   * attentes se comptent sur les lignes.
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
      default: {
        const exhaustive: never = action
        throw new Error(`Action non geree : ${String(exhaustive)}`)
      }
    }
  })
  private readonly commandError = this.sidecar.errorFor(
    "start_tagging",
    "resume_run",
    "discard_run",
    "commit_run",
    "retry_write",
    "rollback",
  )
  /**
   * `lastError` n'a qu'un emplacement : un `rollback` lance depuis les Reglages (`rollback_unavailable`
   * nomme alors le run vise) y atterrit aussi. Il ne se montre ici que s'il ne vise pas un autre run ;
   * sans identifiant (`phase_busy`), rien ne le distingue d'un refus de cet ecran.
   */
  protected readonly error = computed(() => {
    const error = this.commandError()

    return error?.command === "rollback" && this.namesAnotherRun(error) ? null : error
  })
  protected readonly percentage = computed(() => progressPercentage(this.progress()))
  protected readonly recovery = this.sidecar.urlRecoveryProgress
  protected readonly recoveryPercentage = computed(() => progressPercentage(this.recovery()))

  constructor() {
    void this.prefill()
  }

  protected async choose(): Promise<void> {
    const chosen = await this.native.pickPath({ directory: true })
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
    // Lu au clic : un reglage fait dans les Reglages vaut des le run suivant.
    const thresholds = await this.preferences.readThresholds()
    await this.sidecar.startTagging(this.folder(), thresholds ?? undefined)
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

  protected openRecap(): void {
    void this.router.navigateByUrl("/tagging/recap")
  }

  private namesAnotherRun(error: SidecarErrorEvent): boolean {
    const runId = errorRunId(error)
    if (runId !== null) {
      return runId !== this.sidecar.taggingRunId()
    }
    const trackId = errorTrackId(error)

    return trackId !== null && !this.tracks().some((track) => track.trackId === trackId)
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string
  }

  private async prefill(): Promise<void> {
    // Page recreee : le run affiche prime sur la derniere destination et `folder` le suit deja.
    if (this.sidecar.requestedFolder() !== null) {
      return
    }
    const destination = await this.preferences.readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
}
