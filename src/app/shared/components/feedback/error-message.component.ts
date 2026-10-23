import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import { PHASE_BUSY, type SidecarErrorEvent } from "../../../core/sidecar/protocol"
import { FADE_IN } from "../../utils/motion"
import { brandName } from "../../utils/sources"

import { MessageComponent, type MessageSize } from "./message.component"

/** Erreur du sidecar dans l'ecran concerne, traduite depuis son `code` et ses `params`. */
@Component({
  selector: "app-error-message",
  imports: [MessageComponent, TranslatePipe],
  template: `
    <app-message severity="error" [size]="size()">{{ key() | translate: params() }}</app-message>
  `,
  host: { class: "block", "animate.enter": FADE_IN },
})
export class ErrorMessageComponent {
  readonly error = input.required<SidecarErrorEvent>()
  readonly size = input<MessageSize>()

  /** Une phrase par phase pour `phase_busy` : le geste qui repare depend de ce qui tourne. */
  protected readonly key = computed(() => {
    const { code, params } = this.error()

    return code === PHASE_BUSY && typeof params["phase"] === "string"
      ? `errors.${PHASE_BUSY}.${params["phase"]}`
      : `errors.${code}`
  })

  /**
   * Une liste est jointe avant l'interpolation, que ngx-translate ecrirait `a,b` ; une
   * source arrive en valeur du contrat et s'affiche par son nom de marque.
   */
  protected readonly params = computed(() =>
    Object.fromEntries(
      Object.entries(this.error().params).map(([key, value]) => [key, displayed(key, value)]),
    ),
  )
}

const displayed = (key: string, value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.join(", ")
  }

  return key === "source" ? brandName(value) : value
}
