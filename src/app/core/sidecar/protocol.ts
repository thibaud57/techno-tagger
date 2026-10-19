/**
 * Miroir manuel de `sidecar/src/tagger/protocol.py`. Pas de generation de code :
 * trop peu de types, par ailleurs stables, pour la rentabiliser.
 */

export type ExtractionMode = "copy" | "move"

export type Phase = "extraction" | "tagging" | "url_recovery" | "write"

export type DuplicateCriterion = "largest_file" | "path_order"

/** Panne d'un fichier copie, deplace ou ecrit : l'extraction, l'ecriture et la restauration la partagent. */
export type FileFailureReason =
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
  readonly reason: FileFailureReason
}

export interface GetVersionCommand {
  readonly command: "get_version"
}

export interface ShutdownCommand {
  readonly command: "shutdown"
}

export interface CancelRunCommand {
  readonly command: "cancel_run"
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

/**
 * Echelle des scores rapidfuzz, que la librairie fixe : ce n'est pas un reglage du projet.
 * `check_thresholds` la borne aussi cote sidecar.
 */
export const SCORE_SCALE = { min: 0, max: 100 } as const

export interface StartTaggingCommand {
  readonly command: "start_tagging"
  readonly folder: string
  /** Omise (non null) quand absent des Settings : le sidecar applique ses propres seuils. */
  readonly thresholds?: ThresholdsPayload
}

export interface ResolveArbitrationCommand {
  readonly command: "resolve_arbitration"
  readonly track_id: string
  /** La liste visee : un geste sur une liste qui n'est plus affichee est refuse. */
  readonly source: ArbitrationSource
  /** Index dans cette liste, `null` pour un refus explicite. */
  readonly candidate: number | null
}

export interface SwitchArbitrationSourceCommand {
  readonly command: "switch_arbitration_source"
  readonly track_id: string
  readonly source: ArbitrationSource
}

export interface ResolveByUrlCommand {
  readonly command: "resolve_by_url"
  readonly track_id: string
  /** URL collee telle quelle : sa forme est jugee par le sidecar. */
  readonly url: string
}

/** Confirmation globale : le point de non-retour, aucun tag n'est ecrit avant. */
export interface CommitRunCommand {
  readonly command: "commit_run"
  readonly run_id: string
}

/** Rejoue l'ecriture des seuls morceaux en echec. */
export interface RetryWriteCommand {
  readonly command: "retry_write"
  readonly run_id: string
}

/** Decrit le dernier run annulable, pour la confirmation des Reglages. */
export interface GetRollbackTargetCommand {
  readonly command: "get_rollback_target"
}

/** Taille du cache, relue a l'ouverture des Reglages. */
export interface GetCacheSizeCommand {
  readonly command: "get_cache_size"
}

/** Refusee en `run_not_written` tant que le run courant attend son ecriture. */
export interface ClearCacheCommand {
  readonly command: "clear_cache"
}

/** Restaure un run entier depuis son dump, ou son seul morceau `track_id`. */
export interface RollbackCommand {
  readonly command: "rollback"
  readonly run_id: string
  readonly track_id: string | null
}

/** Au lancement : un run interrompu attend-il ? */
export interface GetInterruptedRunCommand {
  readonly command: "get_interrupted_run"
}

/** Repartir de zero : le sidecar repond par l'annonce suivante. */
export interface DiscardRunCommand {
  readonly command: "discard_run"
  readonly run_id: string
}

/** Reprend le run annonce : decisions rendues, seuls les morceaux restants partent. */
export interface ResumeRunCommand {
  readonly command: "resume_run"
  readonly run_id: string
}

export interface ListRunsCommand {
  readonly command: "list_runs"
}

/** Rouvre le recapitulatif d'un run passe, sans rien rejouer. */
export interface LoadRunCommand {
  readonly command: "load_run"
  readonly run_id: string
}

/** Prepare l'issue de retour d'un run, courant ou passe : export ecrit, URL construite. */
export interface PrepareFeedbackCommand {
  readonly command: "prepare_feedback"
  readonly run_id: string
}

export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | CancelRunCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand
  | SetApiKeyCommand
  | StartTaggingCommand
  | ResolveArbitrationCommand
  | SwitchArbitrationSourceCommand
  | ResolveByUrlCommand
  | CommitRunCommand
  | RetryWriteCommand
  | GetRollbackTargetCommand
  | RollbackCommand
  | GetInterruptedRunCommand
  | DiscardRunCommand
  | ResumeRunCommand
  | ListRunsCommand
  | LoadRunCommand
  | GetCacheSizeCommand
  | ClearCacheCommand
  | PrepareFeedbackCommand

export interface VersionEvent {
  readonly event: "version"
  readonly version: string
  /** Seul le sidecar lit le keyring : l'interface l'apprend ici. */
  readonly api_key_configured: boolean
  /** Seuils que le sidecar applique sans `thresholds` : valeurs de depart des Reglages. */
  readonly default_thresholds: ThresholdsPayload
  /** Fichier de logs courant, que les Reglages revelent dans l'Explorateur. */
  readonly log_file: string
  /** Lance avec `TECHNO_TAGGER_SENTRY_SELFTEST=1` : l'interface envoie son evenement de test. */
  readonly sentry_selftest: boolean
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
export type TrackState = "resolved" | "unresolved" | "written" | "write_error" | "rolled_back"

export type TrackResolution = "auto" | "arbitration" | "url" | "none"

/** Motif d'un morceau non resolu par la recherche. */
export type ResolutionFailureReason =
  "empty_query" | "no_result" | "below_threshold" | "user_refused" | "source_unavailable"

/** Un seul champ `failure_reason` sur le fil : les deux jeux y partagent un espace de chaines disjoint. */
export type TrackFailureReason = ResolutionFailureReason | FileFailureReason

/** `name_taken` n'est emis que par la restauration, qui refuse d'ecraser un fichier. */
export type RollbackFailureReason = FileFailureReason | "name_taken"

export type TrackSource = "beatport" | "bandcamp" | "soundcloud"

/** `run_finished` porte la phase close : la boucle reseau, puis l'ecriture. */
export type RunPhase = "network" | "write"

/** Champs de la table des tags ecrits (ADR-011). */
export type TagField =
  | "artist"
  | "remixer"
  | "title"
  | "album"
  | "date"
  | "genre"
  | "label"
  | "catalog_number"
  | "bpm"
  | "key"
  | "isrc"
  | "track_number"
  | "url"
  | "source_id"
  | "source"

export type TagSystem = "id3" | "vorbis"

/** Une ligne du detail : `key` est celle du fichier ecrit, `value` nulle si absente. */
export interface TagValue {
  readonly field: TagField
  readonly key: string
  readonly value: string | null
}

/** Tags d'origine d'un morceau, tels que le fichier les portait a l'ouverture du run. */
export interface TagsBefore {
  readonly system: TagSystem
  readonly comment: string | null
  readonly fields: readonly TagValue[]
}

export interface TrackEntry {
  readonly track_id: string
  readonly file_name: string
  readonly artist: string
  readonly title: string
  /** Nul quand le fichier etait illisible a l'ouverture du run. */
  readonly tags_before: TagsBefore | null
}

export interface RunStartedEvent {
  readonly event: "run_started"
  readonly run_id: string
  /** Dossier du run tel que le sidecar le lit. */
  readonly folder: string
  readonly tracks: readonly TrackEntry[]
}

/** Artiste et titre que la source ecrira, calcules par le sidecar. */
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
  /** Nul pour un non resolu. */
  readonly tags_after: readonly TagValue[] | null
  /** Le dump du run porte l'origine du morceau : le sidecar est seul a savoir si une restauration est possible. */
  readonly restorable: boolean
  /** Lien vers la fiche du candidat retenu, nul sans candidat. */
  readonly source_url: string | null
}

/** Les deux seules sources qu'un arbitrage met en jeu : celles que le pipeline interroge. */
export type ArbitrationSource = "beatport" | "bandcamp"

/** Un candidat en zone grise. Son index dans un geste est sa position dans la liste. */
export interface CandidatePayload {
  readonly artist: string
  readonly title: string
  /** Nuls sur Bandcamp, dont la recherche ne rend ni l'un ni l'autre. */
  readonly label: string | null
  readonly year: number | null
  readonly scores: TrackScores
}

/** Etat complet d'un arbitrage, commun aux deux evenements : l'entree se remplace en bloc. */
export interface ArbitrationState {
  readonly track_id: string
  readonly source: ArbitrationSource
  /** Beatport n'a pas repondu : aucun candidat ne peut valider seul. */
  readonly beatport_unavailable: boolean
  readonly candidates: readonly CandidatePayload[]
  /** Pourquoi la liste Bandcamp affichee est vide, `null` sinon. */
  readonly empty_reason: ResolutionFailureReason | null
  /** La liste que `switch_arbitration_source` peut reafficher, `null` sinon. */
  readonly other_source: ArbitrationSource | null
}

export interface ArbitrationRequiredEvent extends ArbitrationState {
  readonly event: "arbitration_required"
}

export interface ArbitrationUpdatedEvent extends ArbitrationState {
  readonly event: "arbitration_updated"
}

export interface RunFinishedEvent {
  readonly event: "run_finished"
  readonly phase: RunPhase
  readonly run_id: string
  readonly resolved: number
  readonly unresolved: number
  readonly written: number
  readonly write_error: number
  readonly awaiting_arbitration: number
  /** JSON du rapport de re-tagging en phase `write`, nul en phase `network` ou si le rapport n'a pas pu etre ecrit. */
  readonly report_path: string | null
}

/** Dernier run annulable : de quoi le nommer dans la confirmation. */
export interface RollbackRun {
  readonly run_id: string
  readonly written_at: string
  readonly folder: string
  readonly tracks: number
}

/** `run` nul : rien a annuler, le bouton des Reglages se grise. */
export interface RollbackTargetEvent {
  readonly event: "rollback_target"
  readonly run: RollbackRun | null
}

export interface CacheSizeEvent {
  readonly event: "cache_size"
  readonly size_bytes: number
}

/** `size_bytes` : ce qui reste, un fichier verrouille survivant au vidage. */
export interface CacheClearedEvent {
  readonly event: "cache_cleared"
  readonly freed_bytes: number
  readonly size_bytes: number
}

export interface RollbackFailure {
  readonly track_id: string
  readonly file_name: string
  readonly reason: RollbackFailureReason
}

export interface RollbackFinishedEvent {
  readonly event: "rollback_finished"
  readonly run_id: string
  readonly track_id: string | null
  readonly restored: readonly string[]
  readonly failed: readonly RollbackFailure[]
}

/** Run a proposer a la reprise ; `folder_missing` ne laisse que l'option de repartir de zero. */
export interface InterruptedRun {
  readonly kind: "interrupted"
  readonly run_id: string
  readonly started_at: string
  readonly folder: string
  readonly processed: number
  readonly total: number
  readonly folder_missing: boolean
}

/** Plan d'une autre version ou illisible : `found` est nul quand le plan n'a pas de version lisible. */
export interface UnreadablePlan {
  readonly kind: "unreadable"
  readonly run_id: string
  readonly started_at: string
  readonly found: number | string | null
  readonly expected: number
}

export interface InterruptedRunEvent {
  readonly event: "interrupted_run"
  readonly run: InterruptedRun | UnreadablePlan | null
}

export interface PastRun {
  readonly run_id: string
  readonly written_at: string
  readonly folder: string
  readonly report_path: string
}

export interface RunsListedEvent {
  readonly event: "runs_listed"
  readonly runs: readonly PastRun[]
}

/** Morceau d'un run passe, relu dans son rapport : sans `restorable`, un run passe se lit sans geste. */
export interface TrackLoaded {
  readonly track_id: string
  readonly file_name: string
  readonly artist: string
  readonly title: string
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly failure_reason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  readonly tags_before: TagsBefore | null
  readonly tags_after: readonly TagValue[] | null
  readonly source_url: string | null
  readonly artwork_path: string | null
}

export interface RunLoadedEvent {
  readonly event: "run_loaded"
  readonly run_id: string
  readonly folder: string
  readonly generated_at: string
  readonly tracks: readonly TrackLoaded[]
}

/** `url` ouvre l'Issue Form pre-rempli, `export_path` designe l'export a reveler dans l'Explorateur. */
export interface FeedbackReadyEvent {
  readonly event: "feedback_ready"
  readonly run_id: string
  readonly url: string
  readonly export_path: string
}

/** Une phase longue tourne deja : `params.phase` la nomme, `command` dit laquelle est refusee. */
export const PHASE_BUSY = "phase_busy"

/** Valeurs de `params.phase` d'un `phase_busy` : la phase qui tourne, la restauration comprise (absente de `Phase`). */
export type BusyPhase = "extraction" | "tagging" | "write" | "rollback"

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
  | ArbitrationUpdatedEvent
  | RunFinishedEvent
  | RollbackTargetEvent
  | RollbackFinishedEvent
  | InterruptedRunEvent
  | RunsListedEvent
  | RunLoadedEvent
  | CacheSizeEvent
  | CacheClearedEvent
  | FeedbackReadyEvent
  | SidecarErrorEvent
