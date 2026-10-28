import { AsyncPipe } from "@angular/common"
import { Component, computed, inject, input, linkedSignal, output, viewChild } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Table, TableModule } from "primeng/table"
import { Tooltip } from "primeng/tooltip"

import { NativeService } from "../../../core/platform/native.service"
import type { TrackState } from "../../../core/sidecar/protocol"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"
import { ArtworkComponent } from "../../../shared/components/display/artwork.component"
import { EmptyStateComponent } from "../../../shared/components/display/empty-state.component"
import { IconComponent } from "../../../shared/components/display/icon.component"
import { NoValueComponent } from "../../../shared/components/display/no-value.component"
import { SkeletonRowsComponent } from "../../../shared/components/display/skeleton-rows.component"
import { SourceLabelComponent } from "../../../shared/components/display/source-label.component"
import {
  type RowStatus,
  StateTagComponent,
} from "../../../shared/components/display/state-tag.component"
import { TruncatedTextComponent } from "../../../shared/components/display/truncated-text.component"
import { joinIdentity, trackMainLine } from "../../../shared/utils/identity"
import { type ReasonKeys, ReasonTextPipe, trackReasonKeys } from "../../../shared/utils/reason"
import { fullHeightTable } from "../../../shared/utils/table"
import { WIDE_TOOLTIP } from "../../../shared/utils/tooltip"

import { MAX_DETAIL_SPAN, TrackDetailComponent, detailSpan } from "./track-detail.component"

/**
 * PrimeNG ne mesure pas ses lignes : a remesurer si `h-14` change sur les `<tr>` (morceau, porteuse
 * et remplissage du detail), que reprennent aussi les lignes en squelette.
 */
const ROW_HEIGHT = 56

/**
 * `numToleratedItems` du scroller : il rend toujours au moins cette valeur moins un de lignes
 * au-dessus de la premiere visible. A `MAX_DETAIL_SPAN + 1`, la ligne porteuse d'un detail reste
 * montee tant qu'une de ses tranches est visible.
 */
const SCROLLER_OPTIONS = { numToleratedItems: MAX_DETAIL_SPAN + 1 }

/**
 * L'arbitrage en attente l'emporte sur l'etat recu ; sans etat, une ligne d'un run regle ne recevra
 * plus rien.
 */
const rowStatus = (state: TrackState | null, arbitrable: boolean, settled: boolean): RowStatus => {
  if (arbitrable) {
    return "awaiting"
  }

  return state ?? (settled ? "not_processed" : "pending")
}

export interface RunRow extends TaggingTrack {
  readonly status: RowStatus
  readonly mainLine: string
  readonly afterLine: string | null
  readonly artworkUrl: string | null
  /** Sa pochette peut encore arriver : le morceau attend son tour dans un run qui tourne. */
  readonly artworkPending: boolean
  readonly reason: ReasonKeys | null
  readonly arbitrable: boolean
  /** Eligibilite envoyee par le sidecar, sur un run non fige, comme `arbitrable`. */
  readonly recoverable: boolean
  /** Morceau écrit ou en échec d'un run confirmé : le dump peut le rendre. */
  readonly restorable: boolean
  readonly restoring: boolean
}

/** Ligne de la table : le morceau, puis, s'il est ouvert, sa ligne porteuse et ses lignes de remplissage. */
type RenderRow =
  | { readonly kind: "track"; readonly key: string; readonly row: RunRow; readonly open: boolean }
  | { readonly kind: "detail"; readonly key: string; readonly row: RunRow; readonly height: number }
  | { readonly kind: "filler"; readonly key: string }

@Component({
  selector: "app-run-list",
  imports: [
    TableModule,
    Tooltip,
    AsyncPipe,
    ReasonTextPipe,
    TranslatePipe,
    StateTagComponent,
    SourceLabelComponent,
    IconComponent,
    TruncatedTextComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    NoValueComponent,
    ArtworkComponent,
    ButtonDirective,
    TrackDetailComponent,
  ],
  templateUrl: "./run-list.component.html",
  host: { class: "block h-full min-h-0" },
})
export class RunListComponent {
  private readonly native = inject(NativeService)

  protected readonly ROW_HEIGHT = ROW_HEIGHT
  protected readonly SCROLLER_OPTIONS = SCROLLER_OPTIONS
  protected readonly WIDE_TOOLTIP = WIDE_TOOLTIP

  readonly tracks = input.required<readonly TaggingTrack[]>()
  /** Le sidecar parcourt encore le dossier : aucune ligne n'est connue. */
  readonly loading = input(false)
  /** « folder » : dossier sans fichier audio ; « search » : filtre ou recherche du recapitulatif. */
  readonly emptyState = input<"folder" | "search">("folder")
  readonly interrupted = input(false)
  /** Run confirme : plus aucune decision n'y entre, le sidecar les refuserait (`run_committed`). */
  readonly frozen = input(false)
  readonly restorableIds = input<ReadonlySet<string>>(new Set())
  readonly restoringTrackId = input<string | null>(null)
  readonly restoreBlocked = input(false)
  readonly arbitrate = output<string>()
  readonly recover = output<string>()
  readonly restore = output<string>()

  private readonly table = viewChild.required(Table)

  /**
   * Lignes deja construites, par objet morceau : le store ne remplace que le morceau qu'un
   * evenement touche, les autres gardent leur ligne et leurs composants enfants (qui la recoivent
   * en input) ne sont pas recontroles. Les entrees meurent avec leur morceau.
   */
  private readonly rowCache = new WeakMap<TaggingTrack, RunRow>()
  /** Entrees fermees de `renderRows` : une reference stable evite de recontroler la ligne a chaque evenement. */
  private readonly closedEntries = new WeakMap<RunRow, RenderRow>()
  /** Construites a la premiere ouverture seulement : un run de 2 000 morceaux en ouvre quelques-uns. */
  private readonly expansions = new WeakMap<RunRow, readonly RenderRow[]>()

  /** Interrompu ou confirme : les lignes encore vides ne recevront plus rien. */
  private readonly settled = computed(() => this.interrupted() || this.frozen())
  protected readonly empty = computed(() => this.tracks().length === 0)
  protected readonly tablePt = computed(() => fullHeightTable(this.empty()))
  /** Calculee ici et non dans le template, ou chaque cycle la rejouerait pour chaque ligne. */
  protected readonly rows = computed<RunRow[]>(() => {
    const frozen = this.frozen()
    const settled = this.settled()
    const restorableIds = this.restorableIds()
    const restoringTrackId = this.restoringTrackId()

    return this.tracks().map((track) => {
      const arbitrable = !frozen && track.arbitration !== null
      const recoverable = !frozen && track.recoverable
      const restorable = restorableIds.has(track.trackId)
      const restoring = restoringTrackId === track.trackId
      const artworkPending = track.state === null && !settled
      const status = rowStatus(track.state, arbitrable, settled)
      const cached = this.rowCache.get(track)
      if (
        cached?.status === status &&
        cached.arbitrable === arbitrable &&
        cached.recoverable === recoverable &&
        cached.restorable === restorable &&
        cached.restoring === restoring &&
        cached.artworkPending === artworkPending
      ) {
        return cached
      }
      const row: RunRow = {
        ...track,
        status,
        mainLine: trackMainLine(track.artist, track.title, track.fileName),
        afterLine:
          track.after === null ? null : joinIdentity(track.after.artist, track.after.title),
        artworkUrl: track.artworkPath === null ? null : this.native.assetUrl(track.artworkPath),
        artworkPending,
        reason: track.failureReason === null ? null : trackReasonKeys(track.failureReason),
        arbitrable,
        recoverable,
        restorable,
        restoring,
      }
      this.rowCache.set(track, row)

      return row
    })
  })

  /**
   * Un seul detail ouvert, oublie quand son morceau quitte la liste : un meme `trackId` revenu avec
   * un nouveau run ne rouvre pas un detail ferme entre-temps.
   */
  protected readonly openId = linkedSignal<readonly TaggingTrack[], string | null>({
    source: this.tracks,
    computation: (tracks, previous) => {
      const open = previous?.value ?? null

      // Sans detail ouvert, aucun parcours des morceaux a chaque evenement.
      return open !== null && tracks.some((track) => track.trackId === open) ? open : null
    },
  })

  /**
   * Ce que rend la table : apres chaque morceau ouvert, `detailSpan` lignes synthetiques de
   * 56px. La premiere porte le detail, les autres le laissent deborder dessus. La ligne portant
   * son `RunRow`, le detail suit les evenements d'un morceau resolu pendant qu'il est ouvert.
   */
  protected readonly renderRows = computed<RenderRow[]>(() => {
    const open = this.openId()
    const rendered: RenderRow[] = []
    for (const row of this.rows()) {
      if (row.trackId === open) {
        rendered.push({ kind: "track", key: `track:${row.trackId}`, row, open: true })
        rendered.push(...this.expansionOf(row))
      } else {
        rendered.push(this.closedEntry(row))
      }
    }

    return rendered
  })

  /** Garde le DOM de la ligne et le focus du bouton de detail d'un evenement a l'autre. */
  protected readonly byKey = (_index: number, row: RenderRow): string => row.key

  protected toggleDetail(row: RunRow): void {
    const open = this.openId()
    if (open !== null && open !== row.trackId) {
      this.keepInPlace(open, row.trackId)
    }
    this.openId.set(open === row.trackId ? null : row.trackId)
  }

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

  /**
   * Un detail referme au-dessus ferait remonter la ligne ouverte : avant le rendu qui le retire.
   * Par `trackId` : un evenement arrive depuis le rendu a pu reconstruire la ligne cliquee.
   */
  private keepInPlace(closing: string, opening: string): void {
    const rows = this.rows()
    const closedAt = rows.findIndex((row) => row.trackId === closing)
    const closed = rows[closedAt]
    if (closed === undefined || closedAt > rows.findIndex((row) => row.trackId === opening)) {
      return
    }
    // `ElementRef<any>` cote PrimeNG.
    const scroller: unknown = this.table().scroller()?.getElementRef()?.nativeElement
    if (scroller instanceof HTMLElement) {
      scroller.scrollBy({ top: -detailSpan(closed) * ROW_HEIGHT })
    }
  }

  private closedEntry(row: RunRow): RenderRow {
    let entry = this.closedEntries.get(row)
    if (entry === undefined) {
      entry = { kind: "track", key: `track:${row.trackId}`, row, open: false }
      this.closedEntries.set(row, entry)
    }

    return entry
  }

  private expansionOf(row: RunRow): readonly RenderRow[] {
    let expansion = this.expansions.get(row)
    if (expansion === undefined) {
      const span = detailSpan(row)
      expansion = Array.from({ length: span }, (_, index): RenderRow =>
        index === 0
          ? { kind: "detail", key: `detail:${row.trackId}`, row, height: span * ROW_HEIGHT }
          : { kind: "filler", key: `filler:${index}:${row.trackId}` },
      )
      this.expansions.set(row, expansion)
    }

    return expansion
  }
}
