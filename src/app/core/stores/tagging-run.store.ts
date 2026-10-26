import { computed, signal, Service } from "@angular/core"

import type {
  ArbitrationRequiredEvent,
  RunFinishedEvent,
  RollbackFinishedEvent,
  RunStartedEvent,
  TagValue,
  TagsBefore,
  TrackEntry,
  TrackFailureReason,
  TrackNames,
  TrackResolution,
  TrackResolvedEvent,
  TrackScores,
  TrackSource,
  TrackState,
} from "../sidecar/protocol"

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
  readonly tagsBefore: TagsBefore | null
  readonly tagsAfter: readonly TagValue[] | null
  /** Fiche de la source retenue, ouverte depuis le detail ; nulle sans candidat. */
  readonly sourceUrl: string | null
  readonly arbitration: ArbitrationRequiredEvent | null
  /** Faux tant que le sidecar n'a rien dit : une ligne jamais resolue n'a pas d'origine au dump. */
  readonly restorable: boolean
  /** Eligibilite au rattrapage telle que le sidecar l'envoie, fausse tant qu'il n'a rien dit. */
  readonly recoverable: boolean
}

export interface RunProgress {
  readonly processed: number
  readonly total: number
}

/** Partages par `pending` et `rolledBack` : un champ d'issue ajoute se remet a vide dans les deux. */
const NO_OUTCOME = {
  failureReason: null,
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
  tagsAfter: null,
  sourceUrl: null,
  arbitration: null,
  restorable: false,
  recoverable: false,
} as const satisfies Partial<TaggingTrack>

const pending = (entry: TrackEntry): TaggingTrack => ({
  trackId: entry.track_id,
  fileName: entry.file_name,
  artist: entry.artist,
  title: entry.title,
  state: null,
  resolution: null,
  tagsBefore: entry.tags_before,
  ...NO_OUTCOME,
})

/** Rendue a son origine : l'issue s'efface, l'identite et la voie restent. */
const rolledBack = (row: TaggingTrack): TaggingTrack => ({
  ...row,
  ...NO_OUTCOME,
  state: "rolled_back",
})

/** Un run est dans un seul de ces etats : fini et interrompu ne se combinent pas. */
type RunLifecycle =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "finished"; readonly event: RunFinishedEvent }
  | { readonly status: "interrupted" }

/** Etat d'un run de re-tagging, alimente par le routage des evenements de `SidecarService`. */
@Service()
export class TaggingRunStore {
  private readonly _runId = signal<string | null>(null)
  private readonly _folder = signal<string | null>(null)
  // L'ordre d'insertion de la Map est celui du run : `patch` ne fait que remplacer
  // une cle existante, jamais en ajouter une.
  private readonly _rows = signal<ReadonlyMap<string, TaggingTrack>>(new Map())
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _lifecycle = signal<RunLifecycle>({ status: "idle" })
  private readonly _lost = signal(false)

  readonly runId = this._runId.asReadonly()
  /** Nul jusqu'a `run_started`. */
  readonly folder = this._folder.asReadonly()
  readonly tracks = computed<readonly TaggingTrack[]>(() => [...this._rows().values()])
  readonly progress = this._progress.asReadonly()
  /** Vrai de l'envoi de `start_tagging` jusqu'a `run_finished` ou une erreur. */
  readonly running = computed(() => this._lifecycle().status === "running")
  readonly finished = computed(() => {
    const lifecycle = this._lifecycle()

    return lifecycle.status === "finished" ? lifecycle.event : null
  })
  /**
   * Arrete par une erreur ou la mort du process : ses morceaux non tranches ne le seront plus.
   * Pose par `failed()` plutot que deduit de `running`, que d'autres arrets eteignent aussi.
   */
  readonly interrupted = computed(() => this._lifecycle().status === "interrupted")
  /** Un nouveau moteur ne connait pas ce run : rien n'en sera ecrit. Ecrit, il reste restaurable par son dump. */
  readonly lost = this._lost.asReadonly()
  /** Morceaux qu'une ecriture toucherait : les resolus pas encore ecrits. */
  readonly writableCount = computed(
    () => this.tracks().filter((track) => track.state === "resolved").length,
  )

  /** Morceaux dont l'ecriture a echoue : ceux qu'une relance reprendrait. */
  readonly writeFailureCount = computed(
    () => this.tracks().filter((track) => track.state === "write_error").length,
  )

  reset(): void {
    this._runId.set(null)
    this._folder.set(null)
    this._rows.set(new Map())
    this._progress.set(null)
    this._lost.set(false)
    this._lifecycle.set({ status: "running" })
  }

  started(event: RunStartedEvent): void {
    this._runId.set(event.run_id)
    this._folder.set(event.folder)
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
      tagsAfter: event.tags_after,
      sourceUrl: event.source_url,
      arbitration: null,
      restorable: event.restorable,
      recoverable: event.recoverable,
    }))
  }

  /**
   * Un run que le moteur ne tient plus restaure sans `track_resolved` : le bilan est alors le
   * seul a dire quelles lignes sont rendues. Les lignes deja passees par lui ne bougent pas.
   */
  restored(event: RollbackFinishedEvent): void {
    if (event.run_id !== this._runId()) {
      return
    }
    const restored = new Set(event.restored)
    this._rows.update(
      (rows) =>
        new Map(
          [...rows].map(([trackId, row]): [string, TaggingTrack] => [
            trackId,
            restored.has(trackId) && row.state !== "rolled_back" ? rolledBack(row) : row,
          ]),
        ),
    )
  }

  awaiting(event: ArbitrationRequiredEvent): void {
    this.patch(event.track_id, (row) => ({ ...row, arbitration: event }))
  }

  /** Le sidecar ne tient plus l'arbitrage : sans cela la ligne resterait cliquable et comptee en attente. */
  droppedAwaiting(trackId: string): void {
    this.patch(trackId, (row) => ({ ...row, arbitration: null }))
  }

  advanced(processed: number, total: number): void {
    this._progress.set({ processed, total })
  }

  completed(event: RunFinishedEvent): void {
    this._lifecycle.set({ status: "finished", event })
  }

  /** Erreur du sidecar ou annulation : le run s'arrete, les lignes restent. */
  failed(): void {
    // Avant `run_started` aucune ligne n'existe, apres `run_finished` le run a sa fin : rien a
    // etiqueter « non traite ». Le process peut mourir apres, pendant l'ecriture.
    this._lifecycle.update((lifecycle) =>
      lifecycle.status === "finished"
        ? lifecycle
        : { status: this._runId() === null ? "idle" : "interrupted" },
    )
  }

  /** Le process est mort : sans run affiche, il n'y a rien a perdre. */
  engineLost(): void {
    this.failed()
    this._lost.set(this._runId() !== null)
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
