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

export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand
  | SetApiKeyCommand

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

/** `ErrorEvent` est un type DOM global : meme raison. */
export interface SidecarErrorEvent {
  readonly event: "error"
  readonly code: string
  readonly params: Record<string, unknown>
  readonly message: string
}

export type SidecarEvent =
  | VersionEvent
  | PlaylistsListedEvent
  | ExtractionProgressEvent
  | ExtractionFinishedEvent
  | SidecarErrorEvent
