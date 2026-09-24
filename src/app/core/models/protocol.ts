/**
 * Miroir manuel de `sidecar/src/tagger/protocol.py`. Pas de generation de code :
 * trop peu de types, et stables, pour la rentabiliser.
 */

export type ExtractionMode = "copy" | "move"

export type Phase = "extraction" | "tagging" | "url_recovery" | "write"

export type DuplicateCriterion = "largest_file" | "path_order"

export type ExtractionFailureReason =
  | "permission_denied"
  | "disk_full"
  | "path_too_long"
  | "file_locked"
  | "file_missing"
  | "write_failed"

export interface PlaylistEntry {
  readonly playlist_id: number
  readonly name: string
  readonly track_count: number
}

export interface DiscardedCandidate {
  readonly path: string
  readonly size: number
}

export interface DuplicateResolution {
  readonly file_name: string
  readonly kept_path: string
  readonly kept_size: number
  readonly criterion: DuplicateCriterion
  readonly discarded: readonly DiscardedCandidate[]
}

export interface ExtractionFailure {
  readonly file_name: string
  readonly reason: ExtractionFailureReason
}

export interface GetVersionCommand {
  readonly command: "get_version"
}

export interface ShutdownCommand {
  readonly command: "shutdown"
}

export interface ListPlaylistsCommand {
  readonly command: "list_playlists"
  readonly playlist_path: string
}

export interface ExtractPlaylistCommand {
  readonly command: "extract_playlist"
  readonly source_folder: string
  readonly destination_folder: string
  readonly playlist_path: string
  /** `null` pour un M3U8, qui ne contient qu'une playlist. */
  readonly playlist_name: string | null
  readonly mode: ExtractionMode
}

export type ExtractionRequest = Omit<ExtractPlaylistCommand, "command">

export interface SetApiKeyCommand {
  readonly command: "set_api_key"
  /** Seul passage de la cle vers le sidecar : elle ne revient jamais vers la webview. */
  readonly api_key: string
}

export interface ThresholdsPayload {
  readonly floor: number
  readonly ceiling: number
}

export interface StartTaggingCommand {
  readonly command: "start_tagging"
  readonly folder: string
  /** Omise (non null) quand absent des Settings : le sidecar applique ses propres seuils. */
  readonly thresholds?: ThresholdsPayload
}

export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand
  | SetApiKeyCommand
  | StartTaggingCommand

export interface VersionEvent {
  readonly event: "version"
  readonly version: string
  /** Seul le sidecar lit le trousseau : l'interface l'apprend ici. */
  readonly api_key_configured: boolean
}

export type PlaylistFormat = "vlc_dump" | "m3u8"

export interface PlaylistsListedEvent {
  readonly event: "playlists_listed"
  /** Reconnu par le sidecar a l'en-tete du fichier : l'interface ne le deduit jamais. */
  readonly playlist_format: PlaylistFormat
  readonly playlists: readonly PlaylistEntry[]
}

/** `ProgressEvent` est un type DOM global : le prefixe evite la collision. */
export interface ExtractionProgressEvent {
  readonly event: "progress"
  readonly phase: Phase
  readonly processed: number
  readonly total: number
}

export interface ExtractionFinishedEvent {
  readonly event: "extraction_finished"
  readonly extracted: readonly string[]
  readonly already_present: readonly string[]
  readonly missing: readonly string[]
  readonly duplicates: readonly DuplicateResolution[]
  readonly failures: readonly ExtractionFailure[]
  readonly report_path: string
}

/** Etat d'un morceau, en trois champs jamais interchangeables (ARCHITECTURE.md § API). */
export type TrackState = "resolved" | "unresolved"

export type TrackResolution = "auto" | "arbitration" | "url" | "none"

export type TrackFailureReason =
  "empty_query" | "no_result" | "below_threshold" | "user_refused" | "source_unavailable"

export type TrackSource = "beatport" | "bandcamp" | "soundcloud"

/** `run_finished` porte la phase close : la boucle reseau, puis l'ecriture. */
export type RunPhase = "network" | "write"

export interface TrackEntry {
  readonly track_id: string
  readonly file_name: string
  readonly artist: string
  readonly title: string
}

export interface RunStartedEvent {
  readonly event: "run_started"
  readonly run_id: string
  readonly tracks: readonly TrackEntry[]
}

/** Artiste et titre que la source ecrira, calcules par le sidecar (ADR-011). */
export interface TrackNames {
  readonly artist: string
  readonly title: string
}

/** Scores deja arrondis : l'ecran affiche « A 96 · T 92 ». */
export interface TrackScores {
  readonly artist: number | null
  readonly title: number
  readonly average: number
}

export interface TrackResolvedEvent {
  readonly event: "track_resolved"
  readonly track_id: string
  readonly state: TrackState
  readonly resolution: TrackResolution
  readonly failure_reason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  /** Chemin dans le cache, lu par `convertFileSrc` : jamais l'image elle-meme. */
  readonly artwork_path: string | null
}

export interface CandidatePayload {
  readonly artist: string
  readonly title: string
  readonly scores: TrackScores
}

export interface ArbitrationRequiredEvent {
  readonly event: "arbitration_required"
  readonly track_id: string
  readonly source: TrackSource
  /** Beatport n'a pas repondu : aucun candidat ne peut valider seul. */
  readonly beatport_unavailable: boolean
  readonly candidates: readonly CandidatePayload[]
}

export interface RunFinishedEvent {
  readonly event: "run_finished"
  readonly phase: RunPhase
  readonly run_id: string
  readonly resolved: number
  readonly unresolved: number
  readonly awaiting_arbitration: number
}

/** `ErrorEvent` est un type DOM global : meme raison. */
export interface SidecarErrorEvent {
  readonly event: "error"
  readonly code: string
  readonly params: Record<string, unknown>
  readonly message: string
  /**
   * Commande qui a echoue, `null` sur une ligne trop malformee pour la designer.
   * Le run de re-tagging tournant en tache de fond pendant que la boucle lit la
   * suite, la derniere commande envoyee n'est pas forcement la fautive.
   */
  readonly command: SidecarCommand["command"] | null
}

export type SidecarEvent =
  | VersionEvent
  | PlaylistsListedEvent
  | ExtractionProgressEvent
  | ExtractionFinishedEvent
  | RunStartedEvent
  | TrackResolvedEvent
  | ArbitrationRequiredEvent
  | RunFinishedEvent
  | SidecarErrorEvent
