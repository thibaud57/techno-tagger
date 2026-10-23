import { Component, computed, input } from "@angular/core"
import { Message } from "primeng/message"

import { IconComponent, type IconName } from "../display/icon.component"

export type MessageSeverity = "info" | "success" | "warn" | "error"
export type MessageSize = "small"

/** L'icone suit la severite, comme la fiche `Message` du design system. */
export const MESSAGE_ICONS = {
  info: "info-circle",
  success: "check-circle",
  warn: "exclamation-triangle",
  error: "times-circle",
} as const satisfies Record<MessageSeverity, IconName>

/** Message inline, seule voie vers `p-message` (texte projete). */
@Component({
  selector: "app-message",
  imports: [Message, IconComponent],
  template: `
    <p-message
      [severity]="severity()"
      [size]="size()"
      [class.animate-none]="!animated()"
      class="w-full"
    >
      <ng-template #icon><app-icon [name]="iconName()" [size]="iconSize()" /></ng-template>
      <!-- Une phrase par ligne : les textes traduits portent leurs retours a la ligne. -->
      <div class="whitespace-pre-line"><ng-content /></div>
    </p-message>
  `,
  host: { class: "block" },
})
export class MessageComponent {
  readonly severity = input<MessageSeverity>("info")
  readonly size = input<MessageSize>()
  /** Faux la ou l'entree ferait bouger un chemin de decision (modale d'arbitrage). */
  readonly animated = input(true)

  protected readonly iconName = computed(() => MESSAGE_ICONS[this.severity()])
  // 20 dans un message, 16 dans un message `small` aligne sur du texte dense (DESIGN.md § Icones).
  protected readonly iconSize = computed(() => (this.size() === "small" ? 16 : 20))
}
