import { Component, input, output } from "@angular/core"
import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { UniqueComponentId } from "primeng/utils"

import { TruncatedTextComponent } from "./truncated-text.component"

/** L'icone du bouton se projette avec l'attribut `icon`. */
@Component({
  selector: "app-path-picker",
  imports: [ButtonDirective, Label, TruncatedTextComponent],
  template: `
    <label pLabel [for]="id">{{ label() }}</label>
    <div class="flex items-center gap-2">
      <button
        pButton
        type="button"
        [id]="id"
        class="shrink-0"
        [outlined]="true"
        [disabled]="disabled()"
        (click)="pick.emit()"
      >
        <ng-content select="[icon]" />{{ buttonLabel() }}
      </button>
      <app-truncated-text class="text-sm text-muted-color" direction="rtl" [text]="path()" />
    </div>
  `,
  host: { class: "flex flex-col gap-2" },
})
export class PathPickerComponent {
  protected readonly id = UniqueComponentId("path-picker-")

  readonly label = input.required<string>()
  readonly buttonLabel = input.required<string>()
  readonly path = input<string | null>(null)
  readonly disabled = input(false)

  readonly pick = output()
}
