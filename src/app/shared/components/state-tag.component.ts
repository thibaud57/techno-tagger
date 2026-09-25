import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Tag, type TagSeverity } from "primeng/tag"

import type { TrackResolution, TrackState } from "../../core/models/protocol"

import { IconComponent, type IconName } from "./icon.component"

interface StateStyle {
  readonly severity: TagSeverity
  readonly icon: IconName
  readonly label: string
}

/**
 * DESIGN.md § Couleurs Semantiques. « En attente » et « a arbitrer » ne correspondent a aucun
 * `state` : rien ne circule sur le flux tant qu'un morceau n'est pas tranche.
 */
const PENDING: StateStyle = { severity: "secondary", icon: "clock", label: "tagging.state.pending" }
/** Run interrompu : l'horloge promettrait une suite qui ne viendra pas. */
const NOT_PROCESSED: StateStyle = {
  severity: "secondary",
  icon: "minus-circle",
  label: "tagging.state.notProcessed",
}
const AWAITING: StateStyle = {
  severity: "info",
  icon: "info-circle",
  label: "tagging.state.awaiting",
}
const UNRESOLVED: StateStyle = {
  severity: "danger",
  icon: "times",
  label: "tagging.state.unresolved",
}
/** Trois issues positives, toutes vertes : c'est le libelle qui porte la voie. */
const RESOLVED: Record<TrackResolution, StateStyle> = {
  auto: { severity: "success", icon: "check", label: "tagging.state.auto" },
  arbitration: { severity: "success", icon: "check", label: "tagging.state.arbitrated" },
  url: { severity: "success", icon: "check", label: "tagging.state.url" },
  none: UNRESOLVED,
}

@Component({
  selector: "app-state-tag",
  imports: [Tag, TranslatePipe, IconComponent],
  template: `
    <p-tag [severity]="style().severity" [attr.data-severity]="style().severity">
      <app-icon [name]="style().icon" [size]="16" />
      {{ style().label | translate }}
    </p-tag>
  `,
})
export class StateTagComponent {
  readonly state = input<TrackState | null>(null)
  readonly resolution = input<TrackResolution | null>(null)
  readonly awaiting = input(false)
  readonly interrupted = input(false)

  protected readonly style = computed<StateStyle>(() => {
    if (this.awaiting()) {
      return AWAITING
    }
    switch (this.state()) {
      case "resolved":
        return RESOLVED[this.resolution() ?? "none"]
      case "unresolved":
        return UNRESOLVED
      default:
        return this.interrupted() ? NOT_PROCESSED : PENDING
    }
  })
}
