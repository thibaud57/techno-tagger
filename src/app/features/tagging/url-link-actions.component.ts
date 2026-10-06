import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  viewChild,
} from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"

import { IconComponent } from "../../shared/components/icon.component"

import { RecoveryUiStore } from "./recovery-ui.store"

/**
 * « Passer » et « Resoudre » du champ de lien, au pied de la modale du lien comme de l'etape
 * lien de l'arbitrage. « Passer » appartient a la modale hote, qui sait ou aller ensuite.
 */
@Component({
  selector: "app-url-link-actions",
  imports: [ButtonDirective, TranslatePipe, IconComponent],
  templateUrl: "./url-link-actions.component.html",
  host: { class: "contents" },
})
export class UrlLinkActionsComponent {
  private readonly recovery = inject(RecoveryUiStore)

  readonly trackId = input.required<string>()
  readonly skipped = output()

  private readonly skipButton = viewChild.required<ElementRef<HTMLButtonElement>>("skipButton")

  protected readonly busy = computed(() => this.recovery.isBusy(this.trackId()))
  protected readonly canResolve = computed(() => this.recovery.canResolve(this.trackId()))

  constructor() {
    // Champ desactive pendant la recherche : « Passer » reste la seule action.
    afterRenderEffect({
      write: () => {
        this.trackId()
        if (!this.recovery.available()) {
          this.skipButton().nativeElement.focus()
        }
      },
    })
  }

  protected resolve(): void {
    this.recovery.resolve(this.trackId())
  }
}
