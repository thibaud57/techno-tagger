import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Message } from "primeng/message"

import type { SidecarErrorEvent } from "../../core/models/protocol"
import { FADE_IN } from "../utils/motion"

import { IconComponent } from "./icon.component"

/** Erreur du sidecar dans l'ecran concerne, traduite depuis son `code` et ses `params`. */
@Component({
  selector: "app-error-message",
  imports: [Message, TranslatePipe, IconComponent],
  template: `
    <p-message severity="error">
      <ng-template #icon><app-icon name="times-circle" [size]="20" /></ng-template>
      {{ "errors." + error().code | translate: params() }}
    </p-message>
  `,
  host: { class: "block", "animate.enter": FADE_IN },
})
export class ErrorMessageComponent {
  readonly error = input.required<SidecarErrorEvent>()

  /** Une liste est jointe avant l'interpolation, que ngx-translate ecrirait `a,b`. */
  protected readonly params = computed(() =>
    Object.fromEntries(
      Object.entries(this.error().params).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
    ),
  )
}
