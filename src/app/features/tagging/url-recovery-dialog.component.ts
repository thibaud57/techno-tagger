import { Component, computed, effect, inject, linkedSignal } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Badge } from "primeng/badge"
import { ButtonDirective } from "primeng/button"
import { Dialog, type DialogPassThrough } from "primeng/dialog"

import { SidecarService } from "../../core/sidecar.service"
import { IconComponent } from "../../shared/components/icon.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { trackMainLine } from "../../shared/utils/identity"
import { NO_MOTION } from "../../shared/utils/motion"

import { RecoveryUiStore } from "./recovery-ui.store"
import { UrlLinkActionsComponent } from "./url-link-actions.component"
import { UrlLinkFormComponent } from "./url-link-form.component"

/**
 * Modale de rattrapage d'un morceau par son lien, ouverte par sa ligne du run ou par le badge
 * du shell. Navigue entre les morceaux rattrapables ; le sidecar reste seul juge de l'URL.
 */
/**
 * Padding bas du contenu au `gap-4` du formulaire : une erreur garde le meme ecart au champ
 * et au pied (DESIGN.md § Feedback), le preset en posant 20px.
 */
const DIALOG_PT: DialogPassThrough = { content: { class: "pb-4" } }

@Component({
  selector: "app-url-recovery-dialog",
  imports: [
    Dialog,
    Badge,
    ButtonDirective,
    TranslatePipe,
    IconComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
    UrlLinkFormComponent,
    UrlLinkActionsComponent,
  ],
  templateUrl: "./url-recovery-dialog.component.html",
})
export class UrlRecoveryDialogComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly recovery = inject(RecoveryUiStore)

  /** Repart du morceau demande a chaque ouverture ; la navigation le deplace ensuite. */
  private readonly shownId = linkedSignal(() => this.recovery.target())
  private readonly tracks = this.sidecar.recoverableTracks
  private readonly index = computed(() =>
    this.tracks().findIndex((track) => track.trackId === this.shownId()),
  )

  protected readonly noMotion = NO_MOTION
  protected readonly dialogPt = DIALOG_PT

  protected readonly track = computed(() => this.tracks()[this.index()] ?? null)
  protected readonly position = computed(() => this.index() + 1)
  protected readonly count = computed(() => this.tracks().length)
  protected readonly hasPrevious = computed(() => this.index() > 0)
  protected readonly hasNext = computed(() => this.index() >= 0 && this.index() < this.count() - 1)
  protected readonly visible = computed(
    () => this.recovery.target() !== null && this.track() !== null,
  )
  protected readonly title = computed(() => {
    const track = this.track()
    return track === null ? null : trackMainLine(track.artist, track.title, track.fileName)
  })
  protected readonly recoveredSource = computed(() => {
    const track = this.track()
    return track?.resolution === "url" ? track.source : null
  })

  constructor() {
    // Le run suivant remplace les morceaux : un morceau qui n'est plus rattrapable ferme la modale.
    effect(() => {
      if (this.recovery.target() !== null && this.track() === null) {
        this.recovery.close()
      }
    })
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.recovery.close()
    }
  }

  protected previous(): void {
    this.step(-1)
  }

  protected next(): void {
    this.step(1)
  }

  /** « Passer » laisse le morceau tel quel : au dernier, il ferme. */
  protected skip(): void {
    if (this.hasNext()) {
      this.next()
    } else {
      this.recovery.close()
    }
  }

  /**
   * Dans un champ rempli, les fleches deplacent le curseur : Alt les rend a la navigation.
   * Hors champ ou champ vide, elles naviguent comme dans l'arbitrage.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return
    }
    const typing =
      event.target instanceof HTMLInputElement && event.target.value !== "" && !event.altKey
    if (typing) {
      return
    }
    event.preventDefault()
    this.step(event.key === "ArrowLeft" ? -1 : 1)
  }

  private step(offset: number): void {
    const target = this.tracks()[this.index() + offset]
    if (target !== undefined) {
      this.shownId.set(target.trackId)
    }
  }
}
