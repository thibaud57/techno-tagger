import type {
  ExtractionFinishedEvent,
  ExtractionRequest,
  PlaylistEntry,
  PlaylistFormat,
  PlaylistsListedEvent,
} from "../app/core/sidecar/protocol"

// Resultat d'extraction partage par les specs : vide, chaque test pose ses listes par spread.

export const EMPTY_EXTRACTION: ExtractionFinishedEvent = {
  event: "extraction_finished",
  extracted: [],
  already_present: [],
  missing: [],
  duplicates: [],
  failures: [],
  report_path: "C:/work/report.json",
}

/** Les choix du dernier lancement : tous les chemins du formulaire, la playlist nommee, la copie. */
export const EXTRACTION_REQUEST = {
  source_folder: "C:/lib",
  destination_folder: "C:/work",
  playlist_path: "C:/x/vlc_media.db",
  playlist_name: "set",
  mode: "copy",
} as const satisfies ExtractionRequest

export const PLAYLISTS: readonly PlaylistEntry[] = [{ playlist_id: 1, name: "set", track_count: 8 }]

export const playlistsListed = (
  playlists: readonly PlaylistEntry[] = PLAYLISTS,
  playlistFormat: PlaylistFormat = "vlc_dump",
): PlaylistsListedEvent => ({
  event: "playlists_listed",
  playlist_format: playlistFormat,
  playlists,
})
