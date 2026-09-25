import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import {
  ArbitrationRequiredEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TrackResolvedEvent,
} from "./models/protocol"
import { TaggingRunStore } from "./tagging-run.store"

const STARTED: RunStartedEvent = {
  event: "run_started",
  run_id: "a3f9c1",
  tracks: [
    { track_id: "a.mp3", file_name: "a.mp3", artist: "Adam Beyer", title: "Your Mind" },
    { track_id: "b.mp3", file_name: "b.mp3", artist: "Amelie Lens", title: "Basiel" },
  ],
}

const RESOLVED: TrackResolvedEvent = {
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

const AWAITING: ArbitrationRequiredEvent = {
  event: "arbitration_required",
  track_id: "b.mp3",
  source: "bandcamp",
  beatport_unavailable: true,
  candidates: [
    { artist: "Amelie Lens", title: "Basiel", scores: { artist: 94, title: 95, average: 95 } },
  ],
}

const FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "network",
  run_id: "a3f9c1",
  resolved: 1,
  unresolved: 0,
  awaiting_arbitration: 1,
}

describe("TaggingRunStore", () => {
  let store: TaggingRunStore

  beforeEach(() => {
    store = TestBed.inject(TaggingRunStore)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists every track of a started run in order", () => {
    store.reset()

    store.started(STARTED)

    expect(store.tracks().map((track) => track.trackId)).toEqual(["a.mp3", "b.mp3"])
    expect(store.tracks()[0]?.state).toBeNull()
    expect(store.runId()).toBe("a3f9c1")
  })

  it("updates a track with its state, source, names, scores and artwork", () => {
    store.reset()
    store.started(STARTED)

    store.resolved(RESOLVED)

    const track = store.tracks()[0]
    expect(track?.state).toBe("resolved")
    expect(track?.source).toBe("beatport")
    expect(track?.after?.title).toBe("Your Mind (Original Mix)")
    expect(track?.scores?.average).toBe(94)
    expect(track?.artworkPath).toBe("C:/AppData/cache/artworks/abc.jpg")
  })

  it("marks a track as awaiting arbitration", () => {
    store.reset()
    store.started(STARTED)

    store.awaiting(AWAITING)

    const track = store.tracks()[1]
    expect(track?.state).toBeNull()
    expect(track?.arbitration?.beatport_unavailable).toBe(true)
  })

  it("exposes the counters of a finished network phase", () => {
    store.reset()
    store.started(STARTED)

    store.completed(FINISHED)

    expect(store.finished()?.awaiting_arbitration).toBe(1)
    expect(store.running()).toBe(false)
  })

  it("clears the previous run when a new one starts", () => {
    store.reset()
    store.started(STARTED)
    store.completed(FINISHED)

    store.reset()

    expect(store.tracks()).toEqual([])
    expect(store.finished()).toBeNull()
    expect(store.running()).toBe(true)
  })

  it("keeps the progress of the run", () => {
    store.reset()
    store.started(STARTED)

    store.advanced(1, 2)

    expect(store.progress()).toEqual({ processed: 1, total: 2 })
  })

  it("stops the run on failure", () => {
    store.reset()
    store.started(STARTED)

    store.failed()

    expect(store.running()).toBe(false)
  })

  it.each([
    [
      "stopped after its listing",
      (run: TaggingRunStore) => {
        run.started(STARTED)
        run.failed()
      },
      true,
    ],
    [
      "stopped before its listing",
      (run: TaggingRunStore) => {
        run.failed()
      },
      false,
    ],
    [
      "finished normally",
      (run: TaggingRunStore) => {
        run.started(STARTED)
        run.completed(FINISHED)
      },
      false,
    ],
  ] as const)("tells whether a run %s is interrupted", (_name, play, expected) => {
    store.reset()

    play(store)

    expect(store.interrupted()).toBe(expected)
  })

  it("ignores a track the run does not know", () => {
    store.reset()
    store.started(STARTED)
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    store.resolved({ ...RESOLVED, track_id: "ghost.mp3" })

    expect(store.tracks().every((track) => track.state === null)).toBe(true)
    expect(spy).toHaveBeenCalled()
  })
})
