import { Component, computed, input, output } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"
import { Tooltip } from "primeng/tooltip"

import type { TaggingTrack } from "../../core/tagging-run.store"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { IconComponent } from "../../shared/components/icon.component"
import { SkeletonRowsComponent } from "../../shared/components/skeleton-rows.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { StateTagComponent } from "../../shared/components/state-tag.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { failureReasonKey, joinIdentity, trackMainLine } from "../../shared/utils/identity"
import { FADE_IN } from "../../shared/utils/motion"
import { SOURCE_NAMES } from "../../shared/utils/sources"
import { fullHeightTable } from "../../shared/utils/table"
import { WIDE_TOOLTIP } from "../../shared/utils/tooltip"

/** PrimeNG ne mesure pas ses lignes : a remesurer si `h-14` change sur le `<tr>`. */
const ROW_HEIGHT = 56

interface RunRow extends TaggingTrack {
  readonly mainLine: string
  readonly afterLine: string | null
  readonly sourceName: string | null
  readonly artworkUrl: string | null
  readonly reasonKey: string | null
  readonly arbitrable: boolean
  readonly recoverable: boolean
}

@Component({
  selector: "app-run-list",
  imports: [
    TableModule,
    Skeleton,
    Tooltip,
    TranslatePipe,
    StateTagComponent,
    SourceLogoComponent,
    IconComponent,
    TruncatedTextComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
  ],
  templateUrl: "./run-list.component.html",
  host: { class: "block h-full min-h-0" },
})
export class RunListComponent {
  protected readonly ROW_HEIGHT = ROW_HEIGHT
  protected readonly FADE_IN = FADE_IN
  protected readonly WIDE_TOOLTIP = WIDE_TOOLTIP

  readonly tracks = input.required<readonly TaggingTrack[]>()
  /** Le sidecar parcourt encore le dossier : aucune ligne n'est connue. */
  readonly loading = input(false)
  readonly interrupted = input(false)
  /** Morceaux que le sidecar accepte de rattraper par lien : lus, jamais deduits ici. */
  readonly recoverable = input<ReadonlySet<string>>(new Set())
  readonly arbitrate = output<string>()
  readonly recover = output<string>()

  protected readonly empty = computed(() => this.tracks().length === 0)
  protected readonly tablePt = computed(() => fullHeightTable(this.empty()))
  /** Calculee ici et non dans le template, ou chaque cycle la rejouerait pour chaque ligne. */
  protected readonly rows = computed<RunRow[]>(() =>
    this.tracks().map((track) => ({
      ...track,
      mainLine: trackMainLine(track.artist, track.title, track.fileName),
      afterLine: track.after === null ? null : joinIdentity(track.after.artist, track.after.title),
      sourceName: track.source === null ? null : SOURCE_NAMES[track.source],
      artworkUrl: track.artworkPath === null ? null : convertFileSrc(track.artworkPath),
      reasonKey: track.failureReason === null ? null : failureReasonKey(track.failureReason),
      arbitrable: track.arbitration !== null,
      recoverable: this.recoverable().has(track.trackId),
    })),
  )

  /**
   * L'arbitrage prime : un morceau en file n'est pas encore rattrapable. Espace ferait
   * defiler la table sans le `preventDefault`.
   */
  protected activate(row: RunRow, event?: Event): void {
    event?.preventDefault()
    if (row.arbitrable) {
      this.arbitrate.emit(row.trackId)
    } else if (row.recoverable) {
      this.recover.emit(row.trackId)
    }
  }
}
