import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"

import type { TaggingTrack } from "../../core/tagging-run.store"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { StateTagComponent } from "../../shared/components/state-tag.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN } from "../../shared/utils/motion"
import { fullHeightTable } from "../../shared/utils/table"

/** PrimeNG ne mesure pas ses lignes : a remesurer si `h-14` change sur le `<tr>`. */
const ROW_HEIGHT = 56

const ARTIST_TITLE_SEPARATOR = " - "

/** Noms de marque : identiques dans les deux langues, aucune cle i18n a tenir. */
const SOURCE_NAMES = { beatport: "Beatport", bandcamp: "Bandcamp", soundcloud: "SoundCloud" }

const stripExtension = (fileName: string): string => fileName.replace(/\.[a-z0-9]+$/i, "")

const joinIdentity = (artist: string, title: string): string =>
  [artist, title].filter((part) => part !== "").join(ARTIST_TITLE_SEPARATOR)

const mainLineOf = (track: TaggingTrack): string => {
  const identity = joinIdentity(track.artist, track.title)

  return identity === "" ? stripExtension(track.fileName) : identity
}

interface RunRow extends TaggingTrack {
  readonly mainLine: string
  readonly afterLine: string | null
  readonly sourceName: string | null
  readonly artworkUrl: string | null
}

@Component({
  selector: "app-run-list",
  imports: [
    TableModule,
    Skeleton,
    TranslatePipe,
    StateTagComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
    EmptyStateComponent,
  ],
  templateUrl: "./run-list.component.html",
  host: { class: "block h-full min-h-0" },
})
export class RunListComponent {
  protected readonly ROW_HEIGHT = ROW_HEIGHT
  protected readonly FADE_IN = FADE_IN

  readonly tracks = input.required<readonly TaggingTrack[]>()

  protected readonly empty = computed(() => this.tracks().length === 0)
  protected readonly tablePt = computed(() => fullHeightTable(this.empty()))
  /** Calculee ici et non dans le template, ou chaque cycle la rejouerait pour chaque ligne. */
  protected readonly rows = computed<RunRow[]>(() =>
    this.tracks().map((track) => ({
      ...track,
      mainLine: mainLineOf(track),
      afterLine: track.after === null ? null : joinIdentity(track.after.artist, track.after.title),
      sourceName: track.source === null ? null : SOURCE_NAMES[track.source],
      artworkUrl: track.artworkPath === null ? null : convertFileSrc(track.artworkPath),
    })),
  )
}
