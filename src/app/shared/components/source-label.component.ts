import { Component, computed, input } from "@angular/core"

import type { TrackSource } from "../../core/models/protocol"
import { SOURCE_NAMES } from "../utils/sources"

import { SourceLogoComponent } from "./source-logo.component"

/** Une source telle que l'interface la montre partout : son logo, puis son nom de marque. */
@Component({
  selector: "app-source-label",
  imports: [SourceLogoComponent],
  template: `<app-source-logo class="shrink-0" [source]="source()" [size]="16" />{{ name() }}`,
  host: { class: "inline-flex items-center gap-2" },
})
export class SourceLabelComponent {
  readonly source = input.required<TrackSource>()

  protected readonly name = computed(() => SOURCE_NAMES[this.source()])
}
