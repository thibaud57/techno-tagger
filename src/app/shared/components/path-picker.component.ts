import { Component, input, output } from "@angular/core"
import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { UniqueComponentId } from "primeng/utils"

import { TruncatedTextComponent } from "./truncated-text.component"

/**
 * Libelle, bouton et chemin se posent en trois cellules dans la grille de l'appelant, le
 * composant n'ayant pas de boite (`contents`). L'icone du bouton se projette avec l'attribut
 * `icon`.
 */
@Component({
  selector: "app-path-picker",
  imports: [ButtonDirective, Label, TruncatedTextComponent],
  template: `
    <label pLabel class="col-start-1" [for]="id">{{ label() }}</label>
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
      class="max-w-full justify-self-end text-sm text-muted-color"
      direction="rtl"
      [text]="path() || placeholder()"
    />
  `,
  host: { class: "contents" },
})
export class PathPickerComponent {
  protected readonly id = UniqueComponentId("path-picker-")

  readonly label = input.required<string>()
  readonly buttonLabel = input.required<string>()
  readonly path = input<string | null>(null)
  /** Une cellule vide laisserait croire a un defaut d'affichage plutot qu'a un choix a faire. */
  readonly placeholder = input("")

  readonly pick = output()
}
