import { Component, input } from "@angular/core"
import { Skeleton } from "primeng/skeleton"

/** De quoi couvrir un ecran 4K aux lignes les plus basses (41px) : le reste est rogne. */
const ROWS = Array.from({ length: 60 }, (_, index) => index)

/**
 * Lignes d'une table en attente de son premier evenement (DESIGN.md § Etats des
 * Composants), a la hauteur et au filet des vraies lignes : rien ne saute a leur arrivee.
 * Posee dans la cellule `relative` du `#emptymessage`, elle en remplit toute la hauteur.
 * `px-4` et `1rem` : le padding de cellule d'Aura (`1rem`) et une ligne de texte, pour que la
 * barre tombe sous le texte qu'elle annonce.
 */
@Component({
  selector: "app-skeleton-rows",
  imports: [Skeleton],
  host: {
    class: "absolute inset-0 overflow-hidden",
    "[style.--tt-skeleton-row]": "rowHeight() + 'px'",
  },
  template: `
    @for (row of rows; track row) {
      <div
        class="flex h-(--tt-skeleton-row) items-center border-b border-(--p-datatable-body-cell-border-color) px-4"
      >
        <p-skeleton height="1rem" />
      </div>
    }
  `,
})
export class SkeletonRowsComponent {
  protected readonly rows = ROWS

  readonly rowHeight = input.required<number>()
}
