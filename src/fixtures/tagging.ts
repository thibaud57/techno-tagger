import type {
  ArbitrationRequiredEvent,
  RunStartedEvent,
  TrackResolvedEvent,
} from "../app/core/models/protocol"
import type { TaggingTrack } from "../app/core/tagging-run.store"

// Evenements d'un run de re-tagging partages par les specs.

export const RUN_STARTED: RunStartedEvent = {
  event: "run_started",
  run_id: "a3f9c1",
  tracks: [
    { track_id: "a.mp3", file_name: "a.mp3", artist: "Adam Beyer", title: "Your Mind" },
    { track_id: "b.mp3", file_name: "b.mp3", artist: "Amelie Lens", title: "Basiel" },
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
}

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
  arbitration: null,
}

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
