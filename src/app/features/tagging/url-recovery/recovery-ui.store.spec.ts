import { signal, type Provider } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import {
  type SidecarStub,
  activeRun,
  provideSidecarStub,
  sidecarStub,
} from "../../../../fixtures/sidecar-stub"
import { arbitrationRequired, recoveredTrack, unresolvedTrack } from "../../../../fixtures/tagging"
import { TRACK_URL } from "../../../../fixtures/url-recovery"
import { type AppEdition, APP_EDITION } from "../../../core/platform/app-edition"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RECOVERY_URL_HINT } from "./recovery-url-hint"
import { RecoveryUiStore } from "./recovery-ui.store"

const mount = (
  tracks: readonly TaggingTrack[] = [unresolvedTrack("a.mp3")],
  providers: readonly Provider[] = [],
) => {
  const service = sidecarStub({
    ...activeRun(),
    taggingTracks: signal(tracks),
    recoverableTracks: signal(tracks),
  })
  TestBed.configureTestingModule({ providers: [provideSidecarStub(service), ...providers] })

  return { store: TestBed.inject(RecoveryUiStore), service }
}

// Lowlands a un lien enregistre dans la demo, le morceau refuse n'en a pas.
const LOWLANDS = "lowlands.mp3"
const REFUSED = "refused.mp3"
const LOWLANDS_URL = "https://www.beatport.com/track/lowlands/12345"
const lowlandsHint = (id: string): string | null => (id === LOWLANDS ? LOWLANDS_URL : null)

const storeWith = ({
  edition,
  hint,
  tracks = [unresolvedTrack(LOWLANDS), unresolvedTrack(REFUSED)],
}: {
  readonly edition: AppEdition
  readonly hint?: (trackId: string) => string | null
  readonly tracks?: readonly TaggingTrack[]
}) =>
  mount(tracks, [
    { provide: APP_EDITION, useValue: edition },
    ...(hint === undefined ? [] : [{ provide: RECOVERY_URL_HINT, useValue: hint }]),
  ]).store

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

    it.each([
      {
        case: "targets the refused track once it left the queue unresolved",
        tracks: [unresolvedTrack("a.mp3")],
      },
      {
        case: "targets a track passed on an empty Bandcamp list, unresolved with its list reason",
        tracks: [unresolvedTrack("a.mp3", "no_result")],
      },
    ])("$case", ({ tracks }) => {
      const { store, service } = mount(tracks)
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

    it.each([
      {
        case: "drops its target once the track is no longer recoverable",
        left: "b.mp3",
        target: null,
      },
      {
        case: "keeps its target while the track stays recoverable",
        left: "a.mp3",
        target: "a.mp3",
      },
    ])("$case", ({ left, target }) => {
      const { store, service } = mount([unresolvedTrack("a.mp3"), unresolvedTrack("b.mp3")])
      store.open("a.mp3")

      service.recoverableTracks.set([unresolvedTrack(left)])

      expect(store.target()).toBe(target)
    })

    it("closes back to no target", () => {
      const { store } = mount()
      store.open()

      store.close()

      expect(store.target()).toBeNull()
    })
  })

  describe("recovered track", () => {
    const TWO = [unresolvedTrack("a.mp3"), unresolvedTrack("b.mp3")]

    it("moves to the next track once the shown one is recovered", () => {
      const { store, service } = mount(TWO)
      store.open("a.mp3")

      service.urlRecovered.set({ trackId: "a.mp3" })

      expect(store.target()).toBe("b.mp3")
    })

    it("closes once the last track is recovered", () => {
      const { store, service } = mount(TWO)
      store.open("b.mp3")

      service.urlRecovered.set({ trackId: "b.mp3" })

      expect(store.target()).toBeNull()
    })

    it("stays on the shown track when another one is recovered", () => {
      const { store, service } = mount(TWO)
      store.open("a.mp3")

      service.urlRecovered.set({ trackId: "b.mp3" })

      expect(store.target()).toBe("a.mp3")
    })

    it("stays on a recovered track opened again when the track list changes", () => {
      const { store, service } = mount(TWO)
      service.urlRecovered.set({ trackId: "a.mp3" })
      store.open("a.mp3")

      service.recoverableTracks.set([recoveredTrack("a.mp3"), recoveredTrack("b.mp3")])

      expect(store.target()).toBe("a.mp3")
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

  describe("demo edition", () => {
    it("prefills and locks a recorded recovery URL in the demo edition", () => {
      const store = storeWith({
        edition: "demo",
        hint: lowlandsHint,
      })

      expect(store.draft(LOWLANDS)).toBe(LOWLANDS_URL)
      expect(store.locked(LOWLANDS)).toBe(true)
      expect(store.canResolve(LOWLANDS)).toBe(true)
    })

    it.each([
      {
        case: "greys out resolving a track without recorded URL in the demo edition",
        trackId: REFUSED,
        hint: () => null,
        tracks: [unresolvedTrack(LOWLANDS), unresolvedTrack(REFUSED)],
      },
      {
        case: "greys out resolving a track already recovered in the demo edition",
        trackId: LOWLANDS,
        hint: lowlandsHint,
        tracks: [recoveredTrack(LOWLANDS), unresolvedTrack(REFUSED)],
      },
    ])("$case", ({ trackId, hint, tracks }) => {
      const store = storeWith({ edition: "demo", hint, tracks })

      expect(store.canResolve(trackId)).toBe(false)
      expect(store.resolveBlocked(trackId)).toBe("demo.unavailable")
    })

    it("keeps recovery free in the desktop edition", () => {
      const store = storeWith({ edition: "desktop" })

      expect(store.draft(LOWLANDS)).toBe("")
      expect(store.locked(LOWLANDS)).toBe(false)
      expect(store.resolveBlocked(LOWLANDS)).toBeNull()
    })
  })
})
