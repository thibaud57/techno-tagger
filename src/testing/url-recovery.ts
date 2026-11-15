import type { SidecarErrorEvent, TrackResolvedEvent } from "../app/core/sidecar/protocol"

import { trackResolved } from "./tagging"

// Evenements de la phase de rattrapage par URL partages par les specs : chaque test pose
// ses ecarts par spread.

/** Lien colle par l'utilisateur : le sidecar seul le juge, aucun test ne lit sa valeur. */
export const TRACK_URL = "https://www.beatport.com/track/midnight-static/99000123"

/** Morceau rattrape par une URL Bandcamp : resolu, sans score ni motif d'echec, encore eligible au rattrapage. */
export const resolvedByUrl = (trackId: string): TrackResolvedEvent =>
  trackResolved(trackId, {
    resolution: "url",
    source: "bandcamp",
    after: { artist: "Amelie Lens", title: "Basiel" },
    scores: null,
    artwork_path: null,
    recoverable: true,
  })

/** Erreur d'un geste de rattrapage, `track_id` joint par le sidecar. */
export const urlRecoveryError = (trackId: string, code = "track_not_found"): SidecarErrorEvent => ({
  event: "error",
  code,
  params: { track_id: trackId, source: "bandcamp" },
  message: "track not found: bandcamp",
  command: "resolve_by_url",
})
