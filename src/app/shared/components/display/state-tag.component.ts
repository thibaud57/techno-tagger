import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Tag, type TagSeverity } from "primeng/tag"

import type { TrackResolution, TrackState } from "../../../core/sidecar/protocol"

import { IconComponent, type IconName } from "./icon.component"

/** Les `state` du flux, plus les trois statuts qu'aucun evenement ne porte : la liste les calcule. */
export type RowStatus = TrackState | "pending" | "awaiting" | "not_processed"

interface StateStyle {
  readonly severity: TagSeverity
  readonly icon: IconName
  readonly label: string
}

/** DESIGN.md § Couleurs Semantiques. */
const PENDING: StateStyle = { severity: "secondary", icon: "clock", label: "tagging.state.pending" }
/** Run interrompu ou confirme : l'horloge promettrait une suite qui ne viendra pas. */
const NOT_PROCESSED: StateStyle = {
  ...PENDING,
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
/** Meme rouge que « non resolu », icone distincte : on le rattrape par la relance. */
const WRITE_ERROR: StateStyle = {
  severity: "danger",
  icon: "exclamation-triangle",
  label: "tagging.state.writeError",
}
/** Rendu a son origine : ni ecrit ni en echec, aucune voie a montrer en vert. */
const ROLLED_BACK: StateStyle = {
  severity: "secondary",
  icon: "undo",
  label: "tagging.state.rolledBack",
}
/** Issues positives, toutes vertes : c'est le libelle qui porte la voie. */
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
    <p-tag
      class="transition-colors"
      [severity]="style().severity"
      [attr.data-severity]="style().severity"
    >
      <app-icon [name]="style().icon" [size]="16" />
      {{ style().label | translate }}
    </p-tag>
  `,
  // En bloc, le host prendrait la hauteur de la ligne de texte et decentrerait l'icone voisine.
  host: { class: "inline-flex" },
})
export class StateTagComponent {
  readonly status = input.required<RowStatus>()
  readonly resolution = input<TrackResolution | null>(null)

  protected readonly style = computed<StateStyle>(() => {
    const status = this.status()
    switch (status) {
      case "awaiting":
        return AWAITING
      case "pending":
        return PENDING
      case "not_processed":
        return NOT_PROCESSED
      // `written` garde le libelle de sa voie.
      case "resolved":
      case "written":
        return RESOLVED[this.resolution() ?? "none"]
      case "unresolved":
        return UNRESOLVED
      case "write_error":
        return WRITE_ERROR
      case "rolled_back":
        return ROLLED_BACK
      default: {
        const exhaustive: never = status

        return exhaustive
      }
    }
  })
}
