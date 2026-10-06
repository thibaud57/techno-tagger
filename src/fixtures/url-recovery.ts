import type {
  ExtractionProgressEvent,
  SidecarErrorEvent,
  TrackResolvedEvent,
} from "../app/core/models/protocol"

// Evenements de la phase de rattrapage par URL partages par les specs : chaque test pose
// ses ecarts par spread.

export const urlProgress = (processed: number, total: number): ExtractionProgressEvent => ({
  event: "progress",
  phase: "url_recovery",
  processed,
  total,
})

/** Morceau rattrape par une URL Bandcamp : resolu, sans score ni motif d'echec. */
export const resolvedByUrl = (trackId: string): TrackResolvedEvent => ({
  event: "track_resolved",
  track_id: trackId,
  state: "resolved",
  resolution: "url",
  failure_reason: null,
  source: "bandcamp",
  after: { artist: "Amelie Lens", title: "Basiel" },
  scores: null,
  artwork_path: null,
})

/** Erreur d'un geste de rattrapage, `track_id` joint par le sidecar. */
export const urlRecoveryError = (trackId: string, code = "track_not_found"): SidecarErrorEvent => ({
  event: "error",
  code,
  params: { track_id: trackId, source: "bandcamp" },
  message: "track not found: bandcamp",
  command: "resolve_by_url",
})
