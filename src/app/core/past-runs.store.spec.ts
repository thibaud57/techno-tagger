import { TestBed } from "@angular/core/testing"

import { PAST_RUN, TRACK_LOADED, runLoaded } from "../../fixtures/past-runs"
import { commandError, phaseBusy } from "../../fixtures/write"

import { PastRunsStore, loadedTrack } from "./past-runs.store"

describe("PastRunsStore", () => {
  let store: PastRunsStore

  beforeEach(() => {
    store = TestBed.inject(PastRunsStore)
  })

  it("turns a loaded track into a read-only run track", () => {
    const track = loadedTrack(TRACK_LOADED)

    expect(track).toMatchObject({
      trackId: "a.mp3",
      fileName: "a.mp3",
      state: "written",
      resolution: "auto",
      sourceUrl: TRACK_LOADED.source_url,
      tagsBefore: TRACK_LOADED.tags_before,
      tagsAfter: TRACK_LOADED.tags_after,
      arbitration: null,
      restorable: false,
    })
  })

  it("keeps the loaded run and ends the loading", () => {
    store.loadStarted(PAST_RUN.run_id)

    store.loadedRun(runLoaded(TRACK_LOADED))

    expect(store.loading()).toBeNull()
    expect(store.loaded()).toMatchObject({
      runId: PAST_RUN.run_id,
      folder: PAST_RUN.folder,
      writtenAt: PAST_RUN.written_at,
    })
    expect(store.loaded()?.tracks).toHaveLength(1)
  })

  it("forgets the loaded run when another one is requested", () => {
    store.loadStarted(PAST_RUN.run_id)
    store.loadedRun(runLoaded(TRACK_LOADED))

    store.loadStarted("b4c5d6")

    expect(store.loaded()).toBeNull()
    expect(store.loading()).toBe("b4c5d6")
  })

  it("keeps the loaded run when the same one is requested again", () => {
    store.loadStarted(PAST_RUN.run_id)
    store.loadedRun(runLoaded(TRACK_LOADED))

    store.loadStarted(PAST_RUN.run_id)

    expect(store.loaded()?.runId).toBe(PAST_RUN.run_id)
  })

  it("ends the loading and keeps the refusal under the run id of the error", () => {
    store.loadStarted(PAST_RUN.run_id)
    const refusal = commandError("load_run", "run_not_found", { run_id: PAST_RUN.run_id })

    store.loadFailed(refusal)

    expect(store.loading()).toBeNull()
    expect(store.refusal()).toEqual({ runId: PAST_RUN.run_id, error: refusal })
  })

  it("attributes a refusal without run id to the run being loaded", () => {
    store.loadStarted(PAST_RUN.run_id)
    const refusal = phaseBusy("load_run", "tagging")

    store.loadFailed(refusal)

    expect(store.loading()).toBeNull()
    expect(store.refusal()).toEqual({ runId: PAST_RUN.run_id, error: refusal })
  })

  it("keeps waiting for the run being loaded when another one is refused", () => {
    store.loadStarted("a3f9c1")
    store.loadStarted("b4c5d6")

    store.loadFailed(commandError("load_run", "run_not_found", { run_id: "a3f9c1" }))

    expect(store.loading()).toBe("b4c5d6")
    expect(store.refusal()?.runId).toBe("a3f9c1")
  })

  it("ignores a refusal nobody waits for", () => {
    store.loadFailed(phaseBusy("load_run", "tagging"))

    expect(store.refusal()).toBeNull()
  })

  it("clears the refusal when the same run is requested again", () => {
    store.loadStarted(PAST_RUN.run_id)
    store.loadFailed(commandError("load_run", "run_not_found", { run_id: PAST_RUN.run_id }))

    store.loadStarted(PAST_RUN.run_id)

    expect(store.refusal()).toBeNull()
  })

  it("keeps the run being loaded when another run answers first", () => {
    store.loadStarted("a3f9c1")
    store.loadStarted("b4c5d6")

    store.loadedRun(runLoaded(TRACK_LOADED))

    expect(store.loaded()).toBeNull()
    expect(store.loading()).toBe("b4c5d6")
  })

  it("keeps the run being loaded when another run answers last", () => {
    store.loadStarted("a3f9c1")
    store.loadStarted("b4c5d6")
    store.loadedRun({ ...runLoaded(TRACK_LOADED), run_id: "b4c5d6" })

    store.loadedRun(runLoaded(TRACK_LOADED))

    expect(store.loaded()?.runId).toBe("b4c5d6")
  })

  it("ends the loading without a refusal when the wait is abandoned", () => {
    store.loadStarted(PAST_RUN.run_id)

    store.loadAbandoned()

    expect(store.loading()).toBeNull()
    expect(store.refusal()).toBeNull()
  })
})
