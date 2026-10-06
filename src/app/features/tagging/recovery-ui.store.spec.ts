import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import { PENDING_TRACK } from "../../../fixtures/tagging"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { RecoveryUiStore } from "./recovery-ui.store"

const URL = "https://amelielens.bandcamp.com/track/basiel"

const row = (trackId: string, state: TaggingTrack["state"]): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  state,
  resolution: state === "resolved" ? "url" : "none",
  failureReason: state === "unresolved" ? "user_refused" : null,
})

const mount = (tracks: readonly TaggingTrack[] = [row("a.mp3", "unresolved")]) => {
  const service = {
    tagging: signal(false),
    taggingRunId: signal<string | null>("run-1"),
    arbitrations: signal<readonly { track_id: string }[]>([]),
    taggingTracks: signal<readonly TaggingTrack[]>(tracks),
    recoverableTracks: signal<readonly TaggingTrack[]>(tracks),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set()),
    resolveByUrl: vi.fn(() => Promise.resolve()),
  }
  TestBed.configureTestingModule({ providers: [{ provide: SidecarService, useValue: service }] })

  return { store: TestBed.inject(RecoveryUiStore), service }
}

describe("RecoveryUiStore", () => {
  describe("linkStep", () => {
    it("stays empty while nothing was refused", () => {
      const { store } = mount()

      expect(store.linkStep()).toBeNull()
    })

    it("stays empty while the refused track is still in the queue", () => {
      const { store, service } = mount()
      service.arbitrations.set([{ track_id: "a.mp3" }])

      store.refused("a.mp3")

      expect(store.linkStep()).toBeNull()
    })

    it("targets the refused track once it left the queue unresolved", () => {
      const { store, service } = mount()
      service.arbitrations.set([{ track_id: "a.mp3" }])
      store.refused("a.mp3")

      service.arbitrations.set([])

      expect(store.linkStep()).toBe("a.mp3")
    })

    it("ignores a refusal made during a previous run", () => {
      const { store, service } = mount()
      store.refused("a.mp3")

      service.taggingRunId.set("run-2")

      expect(store.linkStep()).toBeNull()
    })

    it("stays empty when the track is unresolved for another reason than the refusal", () => {
      const { store, service } = mount([
        { ...row("a.mp3", "unresolved"), failureReason: "no_result" },
      ])
      store.refused("a.mp3")

      service.arbitrations.set([])

      expect(store.linkStep()).toBeNull()
    })

    it("stays empty when the refused track was resolved meanwhile", () => {
      const { store } = mount([row("a.mp3", "resolved")])

      store.refused("a.mp3")

      expect(store.linkStep()).toBeNull()
    })

    it("empties once the step is left", () => {
      const { store } = mount()
      store.refused("a.mp3")

      store.leaveLinkStep()

      expect(store.linkStep()).toBeNull()
    })
  })

  describe("canResolve", () => {
    it("refuses an empty link", () => {
      const { store } = mount()

      expect(store.canResolve("a.mp3")).toBe(false)
    })

    it("accepts a pasted link", () => {
      const { store } = mount()
      store.edit("a.mp3", URL)

      expect(store.canResolve("a.mp3")).toBe(true)
    })

    it("refuses while a gesture is in flight for the track", () => {
      const { store, service } = mount()
      store.edit("a.mp3", URL)

      service.urlRecoveryBusy.set(new Set(["a.mp3"]))

      expect(store.canResolve("a.mp3")).toBe(false)
    })

    it("refuses during a search", () => {
      const { store, service } = mount()
      store.edit("a.mp3", URL)

      service.tagging.set(true)

      expect(store.canResolve("a.mp3")).toBe(false)
    })
  })

  describe("resolve", () => {
    it("sends the pasted link for its track", () => {
      const { store, service } = mount()
      store.edit("a.mp3", URL)

      store.resolve("a.mp3")

      expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", URL)
    })

    it("sends nothing on an empty link", () => {
      const { store, service } = mount()

      store.resolve("a.mp3")

      expect(service.resolveByUrl).not.toHaveBeenCalled()
    })

    it("sends nothing while a gesture is in flight", () => {
      const { store, service } = mount()
      store.edit("a.mp3", URL)
      service.urlRecoveryBusy.set(new Set(["a.mp3"]))

      store.resolve("a.mp3")

      expect(service.resolveByUrl).not.toHaveBeenCalled()
    })

    it("sends nothing during a search", () => {
      const { store, service } = mount()
      store.edit("a.mp3", URL)
      service.tagging.set(true)

      store.resolve("a.mp3")

      expect(service.resolveByUrl).not.toHaveBeenCalled()
    })
  })

  describe("open", () => {
    it("targets the given track", () => {
      const { store } = mount([row("a.mp3", "unresolved"), row("b.mp3", "unresolved")])

      store.open("b.mp3")

      expect(store.target()).toBe("b.mp3")
    })

    it("targets the first unresolved track without an id", () => {
      const { store } = mount([row("a.mp3", "resolved"), row("b.mp3", "unresolved")])

      store.open()

      expect(store.target()).toBe("b.mp3")
    })

    it("closes back to no target", () => {
      const { store } = mount()
      store.open()

      store.close()

      expect(store.target()).toBeNull()
    })
  })

  it("counts the unresolved recoverable tracks only", () => {
    const { store } = mount([
      row("a.mp3", "unresolved"),
      row("b.mp3", "resolved"),
      row("c.mp3", "unresolved"),
    ])

    expect(store.unresolvedCount()).toBe(2)
  })

  it("forgets the links pasted during a previous run", () => {
    const { store, service } = mount()
    store.edit("a.mp3", URL)

    service.taggingRunId.set("run-2")

    expect(store.draft("a.mp3")).toBe("")
  })
})
