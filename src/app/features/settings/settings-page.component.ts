import { Component, computed, effect, inject, signal, untracked } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputPassword } from "primeng/inputpassword"
import { Label } from "primeng/label"
import { Tag } from "primeng/tag"
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
import { TOOLTIP_DELAY } from "../../shared/utils/tooltip"

interface ApiKeyEntry {
  apiKey: string
}

/** `Intl` et non `DatePipe` : aucune locale FR n'est enregistree. */
const runDate = (iso: string, language: string | null): string => {
  const date = new Date(iso)
  // `format` leve une RangeError sur une date invalide, et un computed la relancerait a chaque lecture.
  if (Number.isNaN(date.getTime())) {
    return iso
  }

  return new Intl.DateTimeFormat(language ?? undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

/** Section API et rangee Rollback : les autres reglages arrivent avec la Feature 7. */
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
    Tag,
    Tooltip,
    ErrorMessageComponent,
    IconComponent,
    RollbackFailuresComponent,
    TruncatedTextComponent,
    DangerConfirmComponent,
  ],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)
  private readonly confirmDanger = injectDangerConfirm()

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau (ADR-012). */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  /** `pInputPassword` n'expose que ce model : la bascule est portee par le template. */
  protected readonly masked = signal(true)
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly canSave = computed(
    () => this.entry().apiKey !== "" && this.sidecar.available() === true,
  )
  protected readonly error = this.sidecar.errorFor("set_api_key")

  protected readonly tooltipDelay = TOOLTIP_DELAY
  /** `undefined` tant que le moteur n'a pas repondu, `null` sans run annulable. */
  protected readonly target = this.sidecar.rollbackTarget
  protected readonly rollingBack = computed(() => this.sidecar.rollingBack() !== null)
  protected readonly targetLine = computed(() => {
    const target = this.target()

    return target
      ? {
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
    if (this.sidecar.writing() || this.rollingBack()) {
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

  constructor() {
    // Le dernier run annulable a pu etre ecrit dans une autre session : seul le moteur le sait.
    // La page se monte avant sa reponse au lancement, et `loadRollbackTarget` n'envoie rien sans
    // moteur : la demande suit donc la disponibilite et non la construction.
    effect(() => {
      if (this.sidecar.available() === true) {
        untracked(() => void this.sidecar.loadRollbackTarget())
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
    // La cle suivante repart masquee, quel que soit l'etat laisse par la precedente.
    this.masked.set(true)
    await this.sidecar.setApiKey(apiKey)
  }

  protected restoreLast(): void {
    const target = this.target()
    const line = this.targetLine()
    if (
      target === null ||
      target === undefined ||
      line === null ||
      this.restoreBlockedReason() !== null
    ) {
      return
    }
    this.confirmDanger(
      "settings.admin.rollback",
      this.translate.instant("settings.admin.rollback.message", line) as string,
      () => {
        void this.sidecar.rollback(target.run_id)
      },
    )
  }
}
