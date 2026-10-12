import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import {
  RUN_STARTED,
  TAGS_AFTER,
  TAGS_BEFORE,
  TRACK_RESOLVED,
  arbitrationRequired,
} from "../../fixtures/tagging"
import { rollbackFinished } from "../../fixtures/write"
import { ArbitrationRequiredEvent, RunFinishedEvent } from "./models/protocol"
import { TaggingRunStore } from "./tagging-run.store"

const AWAITING: ArbitrationRequiredEvent = {
  ...arbitrationRequired("b.mp3"),
  source: "bandcamp",
  beatport_unavailable: true,
}

const FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "network",
  run_id: "a3f9c1",
  resolved: 1,
  unresolved: 0,
  written: 0,
  write_error: 0,
  awaiting_arbitration: 1,
  report_path: null,
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

    store.started(RUN_STARTED)

    expect(store.tracks().map((track) => track.trackId)).toEqual(["a.mp3", "b.mp3"])
    expect(store.tracks()[0]?.state).toBeNull()
    expect(store.runId()).toBe("a3f9c1")
  })

  it("updates a track with its state, source, names, scores and artwork", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.resolved(TRACK_RESOLVED)

    const track = store.tracks()[0]
    expect(track?.state).toBe("resolved")
    expect(track?.source).toBe("beatport")
    expect(track?.after?.title).toBe("Dim Orbit (Original Mix)")
    expect(track?.scores?.average).toBe(94)
    expect(track?.artworkPath).toBe("C:/AppData/cache/artworks/abc.jpg")
  })

  it("exposes the tags before from the start and the tags after once resolved", () => {
    store.reset()
    store.started({
      ...RUN_STARTED,
      tracks: [
        {
          track_id: "a.mp3",
          file_name: "a.mp3",
          artist: "Lior Vance",
          title: "Dim Orbit",
          tags_before: TAGS_BEFORE,
        },
      ],
    })
    const started = store.tracks()[0]

    store.resolved({ ...TRACK_RESOLVED, tags_after: TAGS_AFTER })

    expect(started?.tagsBefore).toEqual(TAGS_BEFORE)
    expect(started?.tagsAfter).toBeNull()
    expect(store.tracks()[0]?.tagsAfter).toEqual(TAGS_AFTER)
  })

  it("keeps the folder of the run from its start and forgets it on reset", () => {
    store.reset()
    store.started(RUN_STARTED)
    const started = store.folder()

    store.reset()

    expect(started).toBe("C:/Sets")
    expect(store.folder()).toBeNull()
  })

  it("marks a track as awaiting arbitration", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.awaiting(AWAITING)

    const track = store.tracks()[1]
    expect(track?.state).toBeNull()
    expect(track?.arbitration?.beatport_unavailable).toBe(true)
  })

  it("exposes the counters of a finished network phase", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.completed(FINISHED)

    expect(store.finished()?.awaiting_arbitration).toBe(1)
    expect(store.running()).toBe(false)
  })

  it("clears the previous run when a new one starts", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.completed(FINISHED)

    store.reset()

    expect(store.tracks()).toEqual([])
    expect(store.finished()).toBeNull()
    expect(store.running()).toBe(true)
  })

  it("keeps the progress of the run", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.advanced(1, 2)

    expect(store.progress()).toEqual({ processed: 1, total: 2 })
  })

  it("stops the run on failure", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.failed()

    expect(store.running()).toBe(false)
  })

  it.each([
    [
      "stopped after its listing",
      (run: TaggingRunStore) => {
        run.started(RUN_STARTED)
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
        run.started(RUN_STARTED)
        run.completed(FINISHED)
      },
      false,
    ],
    // Le process peut mourir apres `run_finished`, pendant l'ecriture : le run a sa fin,
    // rien n'est a etiqueter « non traite ».
    [
      "whose process died after finishing",
      (run: TaggingRunStore) => {
        run.started(RUN_STARTED)
        run.completed(FINISHED)
        run.failed()
      },
      false,
    ],
  ] as const)("tells whether a run %s is interrupted", (_name, play, expected) => {
    store.reset()

    play(store)

    expect(store.interrupted()).toBe(expected)
  })

  it("loses a started run with its engine until a new run starts", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.engineLost()
    const lost = store.lost()
    store.reset()

    expect(lost).toBe(true)
    expect(store.lost()).toBe(false)
  })

  it("loses nothing when the engine dies before a run starts", () => {
    store.engineLost()

    expect(store.lost()).toBe(false)
  })

  it("rolls back a written row from the summary alone, as a rolled back resolution would", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.resolved({ ...TRACK_RESOLVED, state: "written", tags_after: TAGS_AFTER })

    store.restored(rollbackFinished())

    expect(store.tracks()[0]).toMatchObject({
      state: "rolled_back",
      resolution: "auto",
      failureReason: null,
      source: null,
      after: null,
      scores: null,
      artworkPath: null,
      tagsAfter: null,
    })
  })

  it("rolls back only the restored rows", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.resolved({ ...TRACK_RESOLVED, state: "written" })
    store.resolved({ ...TRACK_RESOLVED, track_id: "b.mp3", state: "write_error" })

    store.restored({ ...rollbackFinished(), restored: ["b.mp3"] })

    expect(store.tracks().map((track) => track.state)).toEqual(["written", "rolled_back"])
  })

  it("leaves a row already rolled back untouched", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.resolved({ ...TRACK_RESOLVED, state: "rolled_back", source: null, after: null })
    const rolledBack = store.tracks()[0]

    store.restored(rollbackFinished())

    expect(store.tracks()[0]).toBe(rolledBack)
  })

  it("ignores the summary of another run", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.resolved({ ...TRACK_RESOLVED, state: "written" })

    store.restored({ ...rollbackFinished(), run_id: "ffffff" })

    expect(store.tracks()[0]?.state).toBe("written")
  })

  it("ignores a track the run does not know", () => {
    store.reset()
    store.started(RUN_STARTED)
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    store.resolved({ ...TRACK_RESOLVED, track_id: "ghost.mp3" })

    expect(store.tracks().every((track) => track.state === null)).toBe(true)
    expect(spy).toHaveBeenCalled()
  })
})
