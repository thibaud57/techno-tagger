import { Component, computed, effect, inject, linkedSignal, signal, untracked } from "@angular/core"
import { FormField, disabled, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputPassword } from "primeng/inputpassword"
import { Label } from "primeng/label"
import { Select } from "primeng/select"
import { Tooltip } from "primeng/tooltip"

import { SidecarService } from "../../core/sidecar.service"
import {
  DangerConfirmComponent,
  injectDangerConfirm,
} from "../../shared/components/danger-confirm.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { runDate } from "../../shared/utils/run-date"
import { TOOLTIP } from "../../shared/utils/tooltip"

import { SettingsRowComponent } from "./settings-row.component"

interface ApiKeyEntry {
  apiKey: string
}

interface PastRunOption {
  readonly value: string
  readonly label: string
}

interface PastRunChoice {
  runId: string | null
}

/** Une cle enregistree se signale par des points en placeholder, sans etre relue (ADR-012). */
export const STORED_KEY_MASK = "•".repeat(24)

/** Section API, rangee Rollback et rangee des runs passes. */
@Component({
  selector: "app-settings-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputPassword,
    Label,
    Select,
    Tooltip,
    ErrorMessageComponent,
    IconComponent,
    RollbackFailuresComponent,
    TruncatedTextComponent,
    DangerConfirmComponent,
    SettingsRowComponent,
  ],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)
  private readonly confirmDanger = injectDangerConfirm()
  private readonly router = inject(Router)

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau (ADR-012). */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  protected readonly typing = computed(() => this.entry().apiKey !== "")
  /**
   * `pInputPassword` n'expose que ce model : la bascule est portee par le template. Toute saisie
   * commencee ou effacee repart masquee, l'oeil n'etant visible que pendant une saisie.
   */
  protected readonly masked = linkedSignal({ source: this.typing, computation: () => true })
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly storedKeyMask = computed(() =>
    this.apiKeyConfigured() ? STORED_KEY_MASK : null,
  )
  protected readonly canSave = computed(() => this.typing() && this.sidecar.available() === true)
  protected readonly error = this.sidecar.errorFor("set_api_key")

  protected readonly tooltip = TOOLTIP
  /** `undefined` tant que le moteur n'a pas repondu, `null` sans run annulable. */
  protected readonly target = this.sidecar.rollbackTarget
  protected readonly rollingBack = computed(() => this.sidecar.rollingBack() !== null)
  protected readonly targetLine = computed(() => {
    const target = this.target()

    return target
      ? {
          runId: target.run_id,
          date: runDate(target.written_at, this.translate.currentLang()),
          folder: target.folder,
          count: target.tracks,
        }
      : null
  })
  protected readonly restoreBlockedReason = computed(() => {
    if (this.sidecar.tagging()) {
      return "tagging.blocked.running"
    }
    if (this.sidecar.filesBusy()) {
      return "tagging.rollback.blocked"
    }
    const target = this.target()
    if (target === undefined) {
      return "settings.admin.rollback.loading"
    }

    return target === null ? "settings.admin.rollback.none" : null
  })
  protected readonly rollbackFailures = computed(
    () => this.sidecar.rollbackFinished()?.failed ?? [],
  )
  protected readonly rollbackError = this.sidecar.errorFor("rollback", "get_rollback_target")
  /** Tableau modifiable : `p-select` n'accepte pas un tableau en lecture seule. */
  protected readonly pastRunOptions = computed<PastRunOption[]>(() => {
    // `currentLang()` est lu ici : la liste se retraduit au changement de langue.
    const language = this.translate.currentLang()

    return (this.sidecar.pastRuns() ?? []).map((run) => ({
      value: run.run_id,
      label: this.translate.instant("settings.admin.rollback.target", {
        date: runDate(run.written_at, language),
        folder: run.folder,
      }) as string,
    }))
  })
  /**
   * Le plus recent par defaut, dans l'ordre du registre. Le choix survit a une nouvelle liste ou a
   * un changement de langue tant que son run y figure.
   */
  protected readonly pastChoice = linkedSignal<PastRunOption[], PastRunChoice>({
    source: this.pastRunOptions,
    computation: (options, previous) => ({
      runId:
        options.find((option) => option.value === previous?.value.runId)?.value ??
        options[0]?.value ??
        null,
    }),
  })
  protected readonly pastFields = form(this.pastChoice, (path) => {
    disabled(path.runId, { when: () => this.pastRunOptions().length === 0 })
  })

  constructor() {
    // Le dernier run annulable a pu etre ecrit dans une autre session : seul le moteur le sait.
    // La page se monte avant sa reponse au lancement, et `loadRollbackTarget` n'envoie rien sans
    // moteur : la demande suit sa disponibilite, pas la construction.
    effect(() => {
      if (this.sidecar.available() === true) {
        untracked(() => {
          void this.sidecar.loadRollbackTarget()
          void this.sidecar.listRuns()
        })
      }
    })
  }

  protected toggleMask(): void {
    this.masked.update((masked) => !masked)
  }

  /** Le champ est vide avant l'envoi : un double clic ne renvoie rien. */
  protected async save(): Promise<void> {
    const apiKey = this.entry().apiKey
    if (apiKey === "") {
      return
    }
    this.entry.set({ apiKey: "" })
    await this.sidecar.setApiKey(apiKey)
  }

  protected restoreLast(): void {
    // Sans cible, la raison de blocage est non nulle et la ligne l'est aussi.
    const line = this.targetLine()
    if (line === null || this.restoreBlockedReason() !== null) {
      return
    }
    this.confirmDanger(
      "settings.admin.rollback",
      this.translate.instant("settings.admin.rollback.message", line) as string,
      () => {
        void this.sidecar.rollback(line.runId)
      },
      true,
    )
  }

  protected openPastRun(): void {
    const runId = this.pastChoice().runId
    if (runId !== null) {
      void this.router.navigateByUrl(`/tagging/recap/${runId}`)
    }
  }
}
