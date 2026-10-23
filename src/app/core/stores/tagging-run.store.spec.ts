import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { silenceConsoleError } from "../../../fixtures/console"
import {
  RUN_ID,
  RUN_STARTED,
  SOURCE_URL,
  TAGS_AFTER,
  TAGS_BEFORE,
  arbitrationRequired,
  trackResolved,
} from "../../../fixtures/tagging"
import { NETWORK_FINISHED, rollbackFinished } from "../../../fixtures/write"
import { ArbitrationRequiredEvent, RunFinishedEvent } from "../sidecar/protocol"
import { TaggingRunStore } from "./tagging-run.store"

const AWAITING: ArbitrationRequiredEvent = {
  ...arbitrationRequired("b.mp3"),
  source: "bandcamp",
  beatport_unavailable: true,
}

const FINISHED: RunFinishedEvent = { ...NETWORK_FINISHED, awaiting_arbitration: 1 }

describe("TaggingRunStore", () => {
  let store: TaggingRunStore

  /** Un run lance, ses deux morceaux listes et pas encore resolus. */
  const startRun = (): void => {
    store.reset()
    store.started(RUN_STARTED)
  }

  beforeEach(() => {
    store = TestBed.inject(TaggingRunStore)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists every track of a started run in order", () => {
    startRun()

    expect(store.tracks().map((track) => track.trackId)).toEqual(["a.mp3", "b.mp3"])
    expect(store.tracks()[0]?.state).toBeNull()
    expect(store.runId()).toBe(RUN_ID)
  })

  it("updates a track with its state, source, names, scores and artwork", () => {
    startRun()

    store.resolved(trackResolved("a.mp3"))

    const track = store.tracks()[0]
    expect(track?.state).toBe("resolved")
    expect(track?.source).toBe("beatport")
    expect(track?.after?.title).toBe("Your Mind (Original Mix)")
    expect(track?.scores?.average).toBe(94)
    expect(track?.artworkPath).toBe("C:/AppData/cache/artworks/abc.jpg")
  })

  it("keeps the source page of a resolved track", () => {
    startRun()

    store.resolved(trackResolved("a.mp3", { source_url: SOURCE_URL }))

    expect(store.tracks()[0]?.sourceUrl).toBe(SOURCE_URL)
  })

  describe("tags", () => {
    const startWithTagsBefore = (): void => {
      store.reset()
      store.started({
        ...RUN_STARTED,
        tracks: [
          {
            track_id: "a.mp3",
            file_name: "a.mp3",
            artist: "Adam Beyer",
            title: "Your Mind",
            tags_before: TAGS_BEFORE,
          },
        ],
      })
    }

    it("exposes the tags before from the start of the run", () => {
      startWithTagsBefore()

      expect(store.tracks()[0]?.tagsBefore).toEqual(TAGS_BEFORE)
      expect(store.tracks()[0]?.tagsAfter).toBeNull()
    })

    it("exposes the tags after once the track is resolved", () => {
      startWithTagsBefore()

      store.resolved(trackResolved("a.mp3", { tags_after: TAGS_AFTER }))

      expect(store.tracks()[0]?.tagsAfter).toEqual(TAGS_AFTER)
    })
  })

  it("keeps the folder of the run from its start", () => {
    startRun()

    expect(store.folder()).toBe("C:/Sets")
  })

  it("forgets the folder on reset", () => {
    startRun()

    store.reset()

    expect(store.folder()).toBeNull()
  })

  it("marks a track as awaiting arbitration", () => {
    startRun()

    store.awaiting(AWAITING)

    const track = store.tracks()[1]
    expect(track?.state).toBeNull()
    expect(track?.arbitration?.beatport_unavailable).toBe(true)
  })

  it("stops awaiting an arbitration the sidecar no longer holds", () => {
    startRun()
    store.awaiting(AWAITING)

    store.droppedAwaiting("b.mp3")

    expect(store.tracks()[1]?.arbitration).toBeNull()
  })

  it("exposes the counters of a finished network phase", () => {
    startRun()

    store.completed(FINISHED)

    expect(store.finished()?.awaiting_arbitration).toBe(1)
    expect(store.running()).toBe(false)
  })

  it("clears the previous run when a new one starts", () => {
    startRun()
    store.completed(FINISHED)

    store.reset()

    expect(store.tracks()).toEqual([])
    expect(store.runId()).toBeNull()
    expect(store.finished()).toBeNull()
    expect(store.running()).toBe(true)
  })

  it("keeps the progress of the run", () => {
    startRun()

    store.advanced(1, 2)

    expect(store.progress()).toEqual({ processed: 1, total: 2 })
  })

  it("stops the run on failure", () => {
    startRun()

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

  it("loses a started run with its engine", () => {
    startRun()

    store.engineLost()

    expect(store.lost()).toBe(true)
  })

  it("is no longer lost once a new run starts", () => {
    startRun()
    store.engineLost()

    store.reset()

    expect(store.lost()).toBe(false)
  })

  it("loses nothing when the engine dies before a run starts", () => {
    store.engineLost()

    expect(store.lost()).toBe(false)
  })

  it("rolls back a written row from the summary alone, as a rolled back resolution would", () => {
    startRun()
    store.resolved(trackResolved("a.mp3", { state: "written", tags_after: TAGS_AFTER }))

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
    startRun()
    store.resolved(trackResolved("a.mp3", { state: "written" }))
    store.resolved(trackResolved("b.mp3", { state: "write_error" }))

    store.restored({ ...rollbackFinished(), restored: ["b.mp3"] })

    expect(store.tracks().map((track) => track.state)).toEqual(["written", "rolled_back"])
  })

  it("leaves a row already rolled back untouched", () => {
    startRun()
    store.resolved(trackResolved("a.mp3", { state: "rolled_back", source: null, after: null }))
    const rolledBack = store.tracks()[0]

    store.restored(rollbackFinished())

    expect(store.tracks()[0]).toBe(rolledBack)
  })

  it("ignores the summary of another run", () => {
    startRun()
    store.resolved(trackResolved("a.mp3", { state: "written" }))

    store.restored({ ...rollbackFinished(), run_id: "ffffff" })

    expect(store.tracks()[0]?.state).toBe("written")
  })

  it("ignores a track the run does not know", () => {
    startRun()
    const spy = silenceConsoleError()

    store.resolved(trackResolved("ghost.mp3"))

    expect(store.tracks().every((track) => track.state === null)).toBe(true)
    expect(spy).toHaveBeenCalled()
  })
})
