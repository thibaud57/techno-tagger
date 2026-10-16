import type {
  ArbitrationRequiredEvent,
  ArbitrationUpdatedEvent,
  RunStartedEvent,
  TagValue,
  TagsBefore,
  TrackFailureReason,
  TrackResolvedEvent,
} from "../app/core/sidecar/protocol"
import type { TaggingTrack } from "../app/core/stores/tagging-run.store"

// Evenements d'un run de re-tagging partages par les specs.

/** Identifiant du run que reprennent toutes les fixtures : une seule valeur a changer. */
export const RUN_ID = "a3f9c1"

/** Fiche source d'un morceau Beatport, que `TRACK_LOADED` et les specs de ligne reprennent. */
export const SOURCE_URL = "https://www.beatport.com/track/your-mind/99000101"

export const RUN_STARTED: RunStartedEvent = {
  event: "run_started",
  run_id: RUN_ID,
  folder: "C:/Sets",
  tracks: [
    {
      track_id: "a.mp3",
      file_name: "a.mp3",
      artist: "Adam Beyer",
      title: "Your Mind",
      tags_before: null,
    },
    {
      track_id: "b.mp3",
      file_name: "b.mp3",
      artist: "Amelie Lens",
      title: "Basiel",
      tags_before: null,
    },
  ],
}

export const TRACK_RESOLVED: TrackResolvedEvent = {
  event: "track_resolved",
  track_id: "a.mp3",
  state: "resolved",
  resolution: "auto",
  failure_reason: null,
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  artwork_path: "C:/AppData/cache/artworks/abc.jpg",
  tags_after: null,
  restorable: false,
  source_url: null,
}

/** Resolution du morceau `trackId` : un test pose ses ecarts (etat, source...) par `overrides`. */
export const trackResolved = (
  trackId: string,
  overrides: Partial<TrackResolvedEvent> = {},
): TrackResolvedEvent => ({ ...TRACK_RESOLVED, track_id: trackId, ...overrides })

/** Ligne du run avant resolution, le premier morceau de `RUN_STARTED`. Un test pose son etat par spread. */
export const PENDING_TRACK: TaggingTrack = {
  trackId: "a.mp3",
  fileName: "a.mp3",
  artist: "Adam Beyer",
  title: "Your Mind",
  state: null,
  resolution: null,
  failureReason: null,
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
  tagsBefore: null,
  tagsAfter: null,
  sourceUrl: null,
  arbitration: null,
  restorable: false,
}

// Les builders ci-dessous nomment le fichier d'apres l'identifiant : deux lignes de meme nom
// ne se distingueraient plus a l'ecran.

/** Ligne resolue d'office, sans detail de candidat : un test pose ses ecarts par spread. */
export const resolvedTrack = (trackId: string): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  state: "resolved",
  resolution: "auto",
})

/** Ligne passee par l'ecriture : le dump garde l'origine d'une ligne ecrite ou en echec, pas restauree. */
export const writtenTrack = (
  trackId: string,
  state: TaggingTrack["state"] = "written",
  restorable = state !== "rolled_back",
): TaggingTrack => ({
  ...resolvedTrack(trackId),
  state,
  restorable,
})

/** Ligne non resolue, refusee par defaut : un test pose son motif ou ses ecarts. */
export const unresolvedTrack = (
  trackId: string,
  failureReason: TrackFailureReason = "user_refused",
): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  state: "unresolved",
  resolution: "none",
  failureReason,
})

/** Ligne rattrapee par une URL Bandcamp : resolue, sans motif d'echec. */
export const recoveredTrack = (trackId: string): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  state: "resolved",
  resolution: "url",
  source: "bandcamp",
})

/** Ligne resolue par Beatport, avec ses scores et sa pochette : le cas nominal d'une ligne affichee. */
export const RESOLVED_TRACK: TaggingTrack = {
  ...resolvedTrack(PENDING_TRACK.trackId),
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
}

/** Tags lus avant l'ecriture : deux champs et un commentaire que l'ecriture supprime. */
export const TAGS_BEFORE: TagsBefore = {
  system: "id3",
  comment: "Ripped by X",
  fields: [
    { field: "artist", key: "TPE1", value: "adam beyer" },
    { field: "bpm", key: "TBPM", value: "130" },
  ],
}

/** Tags apres ecriture, memes champs et memes cles que `TAGS_BEFORE`. */
export const TAGS_AFTER: readonly TagValue[] = [
  { field: "artist", key: "TPE1", value: "Adam Beyer" },
  { field: "bpm", key: "TBPM", value: "130" },
]

/** Zone grise nominale : Beatport a repondu, un candidat. Un test pose ses ecarts par spread. */
export const arbitrationRequired = (trackId: string): ArbitrationRequiredEvent => ({
  event: "arbitration_required",
  track_id: trackId,
  source: "beatport",
  beatport_unavailable: false,
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind (Radio Edit)",
      label: "Drumcode",
      year: 2023,
      scores: { artist: 96, title: 84, average: 90 },
    },
  ],
  empty_reason: null,
  other_source: null,
})

/** Bascule sur Bandcamp, sans candidat : Beatport a ete tente avant. */
export const arbitrationUpdated = (trackId: string): ArbitrationUpdatedEvent => ({
  ...arbitrationRequired(trackId),
  event: "arbitration_updated",
  source: "bandcamp",
  candidates: [],
  empty_reason: "no_result",
  other_source: "beatport",
})

/** Ligne en attente d'arbitrage : la demande du sidecar est portee par la ligne. */
export const awaitingTrack = (trackId: string): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  arbitration: arbitrationRequired(trackId),
})
