import { Component, computed, input } from "@angular/core"
import { Skeleton } from "primeng/skeleton"

import { FADE_IN } from "../utils/motion"

import { IconComponent } from "./icon.component"

/** Pochette en trois états, jamais deux : image, squelette, cadre neutre (DESIGN.md § Mapping Composants). */
@Component({
  selector: "app-artwork",
  imports: [Skeleton, IconComponent],
  template: `
    @if (url(); as src) {
      <img
        class="rounded-sm object-cover"
        alt=""
        [width]="px()"
        [height]="px()"
        [src]="src"
        [animate.enter]="FADE_IN"
      />
    } @else if (pending()) {
      <p-skeleton
        [width]="px() + 'px'"
        [height]="px() + 'px'"
        borderRadius="var(--p-border-radius-sm)"
      />
    } @else {
      <!-- La source n'en fournit pas, ou le morceau n'a pas de source. Une cellule vide
           laisserait un trou que l'oeil lit comme un chargement qui n'arrive jamais. -->
      <div
        class="flex items-center justify-center rounded-sm border border-surface bg-surface-800 text-muted-color"
        [class.size-8]="!large()"
        [class.size-42]="large()"
      >
        <app-icon name="image" [size]="large() ? 24 : 16" />
      </div>
    }
  `,
  host: { class: "flex shrink-0" },
})
export class ArtworkComponent {
  protected readonly FADE_IN = FADE_IN

  readonly url = input.required<string | null>()
  /** Le morceau attend son tour : sa pochette peut encore arriver. */
  readonly pending = input.required<boolean>()
  /** Pochette du détail (168px, la largeur de « Restaurer ce morceau » sous elle) plutôt que vignette de la liste (32px). */
  readonly large = input(false)

  protected readonly px = computed(() => (this.large() ? 168 : 32))
}
