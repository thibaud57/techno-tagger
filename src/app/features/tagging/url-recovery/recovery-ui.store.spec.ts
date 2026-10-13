import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import { type SidecarStub, sidecarStub } from "../../../../fixtures/sidecar-stub"
import { arbitrationRequired, recoveredTrack, unresolvedTrack } from "../../../../fixtures/tagging"
import { TRACK_URL } from "../../../../fixtures/url-recovery"
import { SidecarService } from "../../../core/sidecar/sidecar.service"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RecoveryUiStore } from "./recovery-ui.store"

const mount = (tracks: readonly TaggingTrack[] = [unresolvedTrack("a.mp3")]) => {
  const service = sidecarStub({
    taggingRunId: signal<string | null>("run-1"),
    taggingTracks: signal(tracks),
    recoverableTracks: signal(tracks),
  })
  TestBed.configureTestingModule({ providers: [{ provide: SidecarService, useValue: service }] })

  return { store: TestBed.inject(RecoveryUiStore), service }
}

const BLOCKERS: [string, (service: SidecarStub) => void][] = [
  [
    "a gesture is in flight for the track",
    (service) => {
      service.urlRecoveryBusy.set(new Set(["a.mp3"]))
    },
  ],
  [
    "a search runs",
    (service) => {
      service.tagging.set(true)
    },
  ],
  [
    "the track is no longer recoverable",
    (service) => {
      service.recoverableTracks.set([])
    },
  ],
]

describe("RecoveryUiStore", () => {
  describe("available", () => {
    it("closes during a search", () => {
      const { store, service } = mount()

      service.tagging.set(true)

      expect(store.available()).toBe(false)
    })

    it("opens again once the search is over", () => {
      const { store, service } = mount()
      service.tagging.set(true)

      service.tagging.set(false)

      expect(store.available()).toBe(true)
    })
  })

  describe("linkStep", () => {
    it("stays empty while nothing was refused", () => {
      const { store } = mount()

      expect(store.linkStep()).toBeNull()
    })

    it("stays empty while the refused track is still in the queue", () => {
      const { store, service } = mount()
      service.arbitrations.set([arbitrationRequired("a.mp3")])

      store.refused("a.mp3")

      expect(store.linkStep()).toBeNull()
    })

    it("targets the refused track once it left the queue unresolved", () => {
      const { store, service } = mount()
      service.arbitrations.set([arbitrationRequired("a.mp3")])
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

    it("targets a track passed on an empty Bandcamp list, unresolved with its list reason", () => {
      const { store, service } = mount([
        { ...unresolvedTrack("a.mp3"), failureReason: "no_result" },
      ])
      service.arbitrations.set([arbitrationRequired("a.mp3")])
      store.refused("a.mp3")

      service.arbitrations.set([])

      expect(store.linkStep()).toBe("a.mp3")
    })

    it("stays empty when the refused track was resolved meanwhile", () => {
      const { store } = mount([recoveredTrack("a.mp3")])

      store.refused("a.mp3")

      expect(store.linkStep()).toBeNull()
    })

    it("empties once its track is no longer recoverable", () => {
      const { store, service } = mount()
      store.refused("a.mp3")

      service.recoverableTracks.set([])

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
      store.edit("a.mp3", TRACK_URL)

      expect(store.canResolve("a.mp3")).toBe(true)
    })

    it.each(BLOCKERS)("refuses when %s", (_case, block) => {
      const { store, service } = mount()
      store.edit("a.mp3", TRACK_URL)

      block(service)

      expect(store.canResolve("a.mp3")).toBe(false)
    })
  })

  describe("resolve", () => {
    it("sends the pasted link for its track", () => {
      const { store, service } = mount()
      store.edit("a.mp3", TRACK_URL)

      store.resolve("a.mp3")

      expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", TRACK_URL)
    })

    it("sends nothing on an empty link", () => {
      const { store, service } = mount()

      store.resolve("a.mp3")

      expect(service.resolveByUrl).not.toHaveBeenCalled()
    })

    it.each(BLOCKERS)("sends nothing when %s", (_case, block) => {
      const { store, service } = mount()
      store.edit("a.mp3", TRACK_URL)
      block(service)

      store.resolve("a.mp3")

      expect(service.resolveByUrl).not.toHaveBeenCalled()
    })
  })

  describe("open", () => {
    it("targets the given track", () => {
      const { store } = mount([unresolvedTrack("a.mp3"), unresolvedTrack("b.mp3")])

      store.open("b.mp3")

      expect(store.target()).toBe("b.mp3")
    })

    it("targets the first unresolved track without an id", () => {
      const { store } = mount([recoveredTrack("a.mp3"), unresolvedTrack("b.mp3")])

      store.open()

      expect(store.target()).toBe("b.mp3")
    })

    it("targets nothing for a track that is not recoverable", () => {
      const { store } = mount()

      store.open("z.mp3")

      expect(store.target()).toBeNull()
    })

    it("drops its target once the track is no longer recoverable", () => {
      const { store, service } = mount([unresolvedTrack("a.mp3"), unresolvedTrack("b.mp3")])
      store.open("a.mp3")

      service.recoverableTracks.set([unresolvedTrack("b.mp3")])

      expect(store.target()).toBeNull()
    })

    it("keeps its target while the track stays recoverable", () => {
      const { store, service } = mount([unresolvedTrack("a.mp3"), unresolvedTrack("b.mp3")])
      store.open("a.mp3")

      service.recoverableTracks.set([unresolvedTrack("a.mp3")])

      expect(store.target()).toBe("a.mp3")
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
      unresolvedTrack("a.mp3"),
      recoveredTrack("b.mp3"),
      unresolvedTrack("c.mp3"),
    ])

    expect(store.unresolvedCount()).toBe(2)
  })

  it("forgets the links pasted during a previous run", () => {
    const { store, service } = mount()
    store.edit("a.mp3", TRACK_URL)

    service.taggingRunId.set("run-2")

    expect(store.draft("a.mp3")).toBe("")
  })
})
