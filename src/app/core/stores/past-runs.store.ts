import { signal, Service } from "@angular/core"

import { errorRunId } from "../sidecar/error-params"
import type { PastRun, RunLoadedEvent, SidecarErrorEvent, TrackLoaded } from "../sidecar/protocol"
import type { TaggingTrack } from "./tagging-run.store"

export interface LoadedRun {
  readonly runId: string
  readonly folder: string
  /** `generated_at` du rapport : le meme instant que `written_at` du registre. */
  readonly writtenAt: string
  readonly tracks: readonly TaggingTrack[]
}

export interface LoadRefusal {
  readonly runId: string
  readonly error: SidecarErrorEvent
}

/** Recopie champ a champ : le sidecar est seul juge des etats. Lecture seule, `restorable` et `recoverable` faux. */
export const loadedTrack = (track: TrackLoaded): TaggingTrack => ({
  trackId: track.track_id,
  fileName: track.file_name,
  artist: track.artist,
  title: track.title,
  state: track.state,
  resolution: track.resolution,
  failureReason: track.failure_reason,
  source: track.source,
  after: track.after,
  scores: track.scores,
  artworkPath: track.artwork_path,
  tagsBefore: track.tags_before,
  tagsAfter: track.tags_after,
  sourceUrl: track.source_url,
  arbitration: null,
  restorable: false,
  recoverable: false,
})

/** Runs ecrits relisibles depuis leurs rapports et celui que le recapitulatif a rouvert. */
@Service()
export class PastRunsStore {
  private readonly _runs = signal<readonly PastRun[] | null>(null)
  private readonly _loaded = signal<LoadedRun | null>(null)
  private readonly _loading = signal<string | null>(null)
  private readonly _refusal = signal<LoadRefusal | null>(null)

  readonly runs = this._runs.asReadonly()
  readonly loaded = this._loaded.asReadonly()
  readonly loading = this._loading.asReadonly()
  /** Porte son `runId` : une page n'affiche que le refus de son run, jamais celui d'un autre. */
  readonly refusal = this._refusal.asReadonly()

  listed(runs: readonly PastRun[]): void {
    this._runs.set(runs)
  }

  /** Un autre run charge ne doit pas rester sous le nom de celui qu'on attend. */
  loadStarted(runId: string): void {
    this._loading.set(runId)
    this._refusal.set(null)
    if (this._loaded()?.runId !== runId) {
      this._loaded.set(null)
    }
  }

  /** `load_run` n'occupe pas de phase : deux chargements peuvent courir, seule la reponse attendue compte. */
  loadedRun(event: RunLoadedEvent): void {
    if (event.run_id !== this._loading()) {
      return
    }
    this._loading.set(null)
    this._loaded.set({
      runId: event.run_id,
      folder: event.folder,
      writtenAt: event.generated_at,
      tracks: event.tracks.map(loadedTrack),
    })
  }

  /** Un refus de phase occupee ne porte pas de `run_id` : il vise le chargement en cours. */
  loadFailed(event: SidecarErrorEvent): void {
    const runId = errorRunId(event) ?? this._loading()
    if (runId === null) {
      return
    }
    this._refusal.set({ runId, error: event })
    if (runId === this._loading()) {
      this._loading.set(null)
    }
  }

  /** Le moteur est perdu : plus de reponse a attendre, sans que ce soit un refus. */
  loadAbandoned(): void {
    this._loading.set(null)
  }
}
