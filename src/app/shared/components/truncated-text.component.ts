import { Component, input } from "@angular/core"
import { Tooltip } from "primeng/tooltip"

import { WIDE_TOOLTIP } from "../utils/tooltip"

@Component({
  selector: "app-truncated-text",
  imports: [Tooltip],
  template: `
    <span
      class="block truncate text-left"
      [attr.dir]="direction()"
      [pTooltip]="text() ?? undefined"
      [tooltipOptions]="tooltip"
      [showOnEllipsis]="true"
      >{{ text() }}</span
    >
  `,
  host: { class: "block min-w-0" },
})
export class TruncatedTextComponent {
  readonly text = input<string | null>(null)
  /** `rtl` coupe par la gauche : la fin d'un chemin, le nom du dossier, reste lisible. */
  readonly direction = input<"ltr" | "rtl">("ltr")

  protected readonly tooltip = WIDE_TOOLTIP
}
