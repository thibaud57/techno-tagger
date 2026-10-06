import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  viewChild,
} from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { InputText } from "primeng/inputtext"
import { Message } from "primeng/message"

import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { failureReasonKey, trackMainLine } from "../../shared/utils/identity"
import { SOURCE_NAMES } from "../../shared/utils/sources"

import { RecoveryUiStore } from "./recovery-ui.store"

/**
 * Champ de lien d'un morceau, commun a la modale du lien et a l'etape lien de l'arbitrage :
 * motif ou source du rattrapage, aide, champ et place de l'erreur. Les boutons restent au
 * pied de la modale qui l'accueille.
 */
@Component({
  selector: "app-url-link-form",
  imports: [InputText, Message, TranslatePipe, ErrorMessageComponent],
  templateUrl: "./url-link-form.component.html",
  host: { class: "flex flex-col gap-4" },
})
export class UrlLinkFormComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly recovery = inject(RecoveryUiStore)

  readonly trackId = input.required<string>()

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field")

  protected readonly available = this.recovery.available

  protected readonly view = computed(() => {
    const trackId = this.trackId()
    const track = this.sidecar.taggingTracks().find((row) => row.trackId === trackId)
    const recovered = track?.resolution === "url" ? (track.source ?? null) : null
    const reason = track?.failureReason ?? null

    return {
      mainLine:
        track === undefined ? trackId : trackMainLine(track.artist, track.title, track.fileName),
      recoveredOn: recovered === null ? null : SOURCE_NAMES[recovered],
      reasonKey: reason === null ? null : failureReasonKey(reason),
      url: this.recovery.draft(trackId),
      busy: this.recovery.isBusy(trackId),
      error: this.sidecar.urlRecoveryErrors().get(trackId) ?? null,
    }
  })

  constructor() {
    // Entree dans le champ pour coller tout de suite, a chaque morceau et a la fin de la recherche.
    afterRenderEffect({
      write: () => {
        this.trackId()
        this.available()
        const field = this.field().nativeElement
        if (!field.disabled) {
          field.focus()
        }
      },
    })
  }

  protected edit(url: string): void {
    this.recovery.edit(this.trackId(), url)
  }

  /** Entree vaut « Resoudre » : meme garde, le geste ne part pas d'un champ vide ou en vol. */
  protected resolve(): void {
    this.recovery.resolve(this.trackId())
  }
}
