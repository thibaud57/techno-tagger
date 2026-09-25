import { Injectable, computed, signal } from "@angular/core"

import type {
  ArbitrationRequiredEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TrackEntry,
  TrackFailureReason,
  TrackNames,
  TrackResolution,
  TrackResolvedEvent,
  TrackScores,
  TrackSource,
  TrackState,
} from "./models/protocol"

/**
 * Une ligne de la liste du run. Tout vient du sidecar : la famille visuelle d'un
 * etat se derive a l'affichage, pas ici.
 */
export interface TaggingTrack {
  readonly trackId: string
  readonly fileName: string
  readonly artist: string
  readonly title: string
  /** `null` : le morceau attend son tour, ou attend un arbitrage. */
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly failureReason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  readonly artworkPath: string | null
  readonly arbitration: ArbitrationRequiredEvent | null
}

export interface RunProgress {
  readonly processed: number
  readonly total: number
}

const pending = (entry: TrackEntry): TaggingTrack => ({
  trackId: entry.track_id,
  fileName: entry.file_name,
  artist: entry.artist,
  title: entry.title,
  state: null,
  resolution: null,
  failureReason: null,
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
  arbitration: null,
})

/**
 * Etat d'un run de re-tagging. `SidecarService` garde la frontiere du transport et
 * lui transmet les evenements : les Features 3 a 6 ajouteront leur propre store.
 */
@Injectable({ providedIn: "root" })
export class TaggingRunStore {
  private readonly _runId = signal<string | null>(null)
  // L'ordre d'insertion de la Map est celui du run : `patch` ne fait que remplacer
  // une cle existante, jamais en ajouter une.
  private readonly _rows = signal<ReadonlyMap<string, TaggingTrack>>(new Map())
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _running = signal(false)
  private readonly _finished = signal<RunFinishedEvent | null>(null)

  readonly runId = this._runId.asReadonly()
  /** Les lignes dans l'ordre du run, pretes pour la table. */
  readonly tracks = computed<readonly TaggingTrack[]>(() => [...this._rows().values()])
  readonly progress = this._progress.asReadonly()
  /** Vrai de l'envoi de `start_tagging` jusqu'a `run_finished` ou une erreur. */
  readonly running = this._running.asReadonly()
  readonly finished = this._finished.asReadonly()
  /** Arrete par une erreur apres `run_started` : ses morceaux non tranches ne le seront plus. */
  readonly interrupted = computed(
    () => this._runId() !== null && !this._running() && this._finished() === null,
  )

  /** Efface le run precedent des l'envoi de la commande : l'ecran ne melange rien. */
  reset(): void {
    this._runId.set(null)
    this._rows.set(new Map())
    this._progress.set(null)
    this._finished.set(null)
    this._running.set(true)
  }

  started(event: RunStartedEvent): void {
    this._runId.set(event.run_id)
    this._rows.set(new Map(event.tracks.map((track) => [track.track_id, pending(track)])))
  }

  resolved(event: TrackResolvedEvent): void {
    this.patch(event.track_id, (row) => ({
      ...row,
      state: event.state,
      resolution: event.resolution,
      failureReason: event.failure_reason,
      source: event.source,
      after: event.after,
      scores: event.scores,
      artworkPath: event.artwork_path,
      arbitration: null,
    }))
  }

  awaiting(event: ArbitrationRequiredEvent): void {
    this.patch(event.track_id, (row) => ({ ...row, arbitration: event }))
  }

  advanced(processed: number, total: number): void {
    this._progress.set({ processed, total })
  }

  completed(event: RunFinishedEvent): void {
    this._finished.set(event)
    this._running.set(false)
  }

  /** Erreur du sidecar ou process mort : le run s'arrete, les lignes restent. */
  failed(): void {
    this._running.set(false)
  }

  private patch(trackId: string, update: (row: TaggingTrack) => TaggingTrack): void {
    const row = this._rows().get(trackId)
    if (row === undefined) {
      console.error("[sidecar] morceau inconnu, contrat desynchronise", trackId)

      return
    }
    // Nouvelle Map : muter celle en place ne notifierait aucun consommateur.
    this._rows.update((rows) => new Map(rows).set(trackId, update(row)))
  }
}
