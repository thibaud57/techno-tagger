import { Component, input, output } from "@angular/core"
import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { UniqueComponentId } from "primeng/utils"

import { TruncatedTextComponent } from "./truncated-text.component"

/**
 * Libelle facultatif, bouton et chemin se posent en cellules dans la grille de l'appelant, le
 * composant n'ayant pas de boite (`contents`). L'icone du bouton se projette avec l'attribut
 * `icon`.
 */
@Component({
  selector: "app-path-picker",
  imports: [ButtonDirective, Label, TruncatedTextComponent],
  template: `
    @if (label(); as text) {
      <label pLabel class="col-start-1" [for]="id">{{ text }}</label>
    }
    <button
      pButton
      type="button"
      [id]="id"
      class="w-full"
      size="small"
      [outlined]="true"
      (click)="pick.emit()"
    >
      <ng-content select="[icon]" />{{ buttonLabel() }}
    </button>
    <app-truncated-text
      class="max-w-full text-sm text-muted-color"
      [class.justify-self-end]="pathAlign() === 'end'"
      [class.justify-self-start]="pathAlign() === 'start'"
      direction="rtl"
      [text]="path() || placeholder()"
    />
  `,
  host: { class: "contents" },
})
export class PathPickerComponent {
  protected readonly id = UniqueComponentId("path-picker-")

  /** `null` quand le bouton se suffit : la cellule disparait de la grille de l'appelant. Requis
   * pour qu'un oubli ne decale pas les colonnes en silence. */
  readonly label = input.required<string | null>()
  readonly buttonLabel = input.required<string>()
  readonly path = input<string | null>(null)
  /** Omis, la cellule reste vide : a reserver a un ecran dont le bloc vide dit deja quoi faire. */
  readonly placeholder = input("")
  /** `start` colle le chemin a son bouton, quand aucune colonne de chemins n'est a aligner. */
  readonly pathAlign = input<"start" | "end">("end")

  readonly pick = output()
}
