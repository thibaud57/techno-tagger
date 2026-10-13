import type {
  PastRun,
  RunLoadedEvent,
  RunsListedEvent,
  TrackLoaded,
} from "../app/core/sidecar/protocol"

import { TAGS_AFTER, TAGS_BEFORE } from "./tagging"

export const PAST_RUN: PastRun = {
  run_id: "a3f9c1",
  written_at: "2026-08-02T21:30:00Z",
  folder: "D:/Sets/Aout",
  report_path: "D:/Sets/Aout/tagging-report-20260802T213000Z.json",
}

export const TRACK_LOADED: TrackLoaded = {
  track_id: "a.mp3",
  file_name: "a.mp3",
  file_after: "Adam Beyer - Your Mind (Original Mix).mp3",
  artist: "Adam Beyer",
  title: "Your Mind",
  state: "written",
  resolution: "auto",
  failure_reason: null,
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  tags_before: TAGS_BEFORE,
  tags_after: TAGS_AFTER,
  source_url: "https://www.beatport.com/track/your-mind/99000101",
  artwork_path: null,
}

export const runsListed = (...runs: PastRun[]): RunsListedEvent => ({ event: "runs_listed", runs })

export const runLoaded = (...tracks: TrackLoaded[]): RunLoadedEvent => ({
  event: "run_loaded",
  run_id: PAST_RUN.run_id,
  folder: PAST_RUN.folder,
  generated_at: PAST_RUN.written_at,
  tracks,
})
