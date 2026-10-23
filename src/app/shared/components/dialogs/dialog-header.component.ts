import { Component, input } from "@angular/core"

import { SourceLogoComponent, type SourceName } from "../display/source-logo.component"
import { TruncatedTextComponent } from "../display/truncated-text.component"

/**
 * En-tete des modales d'un morceau (arbitrage, lien). Le logo de la source se cale sur la
 * ligne du titre (h-7, sa hauteur de ligne), comme la croix du preset.
 */
@Component({
  selector: "app-dialog-header",
  imports: [SourceLogoComponent, TruncatedTextComponent],
  // Ecarts hors echelle : le nom de fichier se lit comme le sous-titre colle au titre (gap-0.5),
  // le logo garde l'ecart des actions d'en-tete (gap-3).
  template: `
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <h3 class="min-w-0 text-lg font-semibold" data-title [attr.id]="titleId()">
        <app-truncated-text [text]="title()" />
      </h3>
      <!-- Ligne gardee meme vide : d'un morceau a l'autre, le contenu ne se decale pas. -->
      <app-truncated-text class="min-h-4 text-xs text-muted-color" [text]="fileName()" />
    </div>
    @if (source(); as shown) {
      <app-source-logo class="flex h-7 items-center" [source]="shown" [size]="20" />
    }
  `,
  host: { class: "flex min-w-0 flex-1 items-start gap-3" },
})
export class DialogHeaderComponent {
  readonly title = input<string | null>(null)
  /** L'id que `p-dialog` pose en `aria-labelledby` et ne reporte sur aucun element avec un template `#header`. */
  readonly titleId = input<string | null>(null)
  readonly fileName = input<string | null>(null)
  readonly source = input<SourceName | null>(null)
}
