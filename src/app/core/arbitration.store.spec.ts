import { TestBed } from "@angular/core/testing"

import { arbitrationRequired } from "../../fixtures/tagging"
import { ArbitrationStore } from "./arbitration.store"
import type { ArbitrationUpdatedEvent } from "./models/protocol"

const onBandcamp = (trackId: string): ArbitrationUpdatedEvent => ({
  ...arbitrationRequired(trackId),
  event: "arbitration_updated",
  source: "bandcamp",
  candidates: [],
  empty_reason: "no_result",
  other_source: "beatport",
})

describe("ArbitrationStore", () => {
  let store: ArbitrationStore

  const queue = (...trackIds: string[]): void => {
    for (const trackId of trackIds) {
      store.required(arbitrationRequired(trackId))
    }
  }

  const queued = (): string[] => store.entries().map((entry) => entry.track_id)

  beforeEach(() => {
    store = TestBed.inject(ArbitrationStore)
  })

  it("queues arbitrations in arrival order and counts them", () => {
    queue("c.mp3", "a.mp3", "b.mp3")

    expect(queued()).toEqual(["c.mp3", "a.mp3", "b.mp3"])
    expect(store.current()?.track_id).toBe("c.mp3")
    expect([store.position(), store.count()]).toEqual([1, 3])
  })

  it("keeps the current arbitration when a new one arrives", () => {
    queue("a.mp3", "b.mp3", "c.mp3")
    store.next()

    store.required(arbitrationRequired("d.mp3"))

    expect(store.current()?.track_id).toBe("b.mp3")
    expect([store.position(), store.count()]).toEqual([2, 4])
  })

  it("replaces an arbitration in place when it is updated", () => {
    queue("a.mp3", "b.mp3")
    store.next()

    store.updated(onBandcamp("b.mp3"))

    expect(queued()).toEqual(["a.mp3", "b.mp3"])
    expect(store.current()?.source).toBe("bandcamp")
    expect(store.position()).toBe(2)
  })

  it("moves to the next arbitration when the current one is resolved", () => {
    queue("a.mp3", "b.mp3", "c.mp3")
    store.next()

    store.resolved("b.mp3")

    expect(store.current()?.track_id).toBe("c.mp3")
    expect([store.position(), store.count()]).toEqual([2, 2])
  })

  it("moves to the previous one when the last one is resolved", () => {
    queue("a.mp3", "b.mp3")
    store.next()

    store.resolved("b.mp3")

    expect(store.current()?.track_id).toBe("a.mp3")
  })

  it.each<[string, string[], (target: ArbitrationStore) => void, string]>([
    [
      "the one before it and the current one are resolved",
      ["a.mp3", "b.mp3", "c.mp3", "d.mp3"],
      (target) => {
        target.resolved("a.mp3")
        target.resolved("b.mp3")
      },
      "c.mp3",
    ],
    [
      "the current one is resolved and a new one arrives",
      ["a.mp3", "b.mp3"],
      (target) => {
        target.resolved("b.mp3")
        target.required(arbitrationRequired("e.mp3"))
      },
      "a.mp3",
    ],
  ])("keeps its place when %s before the next read", (_case, trackIds, events, expected) => {
    queue(...trackIds)
    store.next()

    events(store)

    expect(store.current()?.track_id).toBe(expected)
  })

  it("leaves no current arbitration once the queue is empty", () => {
    queue("a.mp3")

    store.resolved("a.mp3")

    expect(store.current()).toBeNull()
    expect([store.position(), store.count()]).toEqual([0, 0])
  })

  it("navigates between arbitrations within bounds", () => {
    queue("a.mp3", "b.mp3")

    store.previous()
    const first = store.current()?.track_id
    store.next()
    store.next()

    expect(first).toBe("a.mp3")
    expect(store.current()?.track_id).toBe("b.mp3")
    expect([store.hasPrevious(), store.hasNext()]).toEqual([true, false])
  })

  it("jumps to the arbitration of a given track", () => {
    queue("a.mp3", "b.mp3", "c.mp3")

    store.open("c.mp3")

    expect(store.current()?.track_id).toBe("c.mp3")
    expect(store.position()).toBe(3)
  })

  it("stays on the current arbitration when asked for a track outside the queue", () => {
    queue("a.mp3", "b.mp3")
    store.next()

    store.open("ghost.mp3")

    expect(store.current()?.track_id).toBe("b.mp3")
    expect(store.openings()).toBe(0)
  })

  it("counts every request to open, even twice for the same track", () => {
    queue("a.mp3")

    store.open("a.mp3")
    store.open("a.mp3")

    expect(store.openings()).toBe(2)
  })

  it.each<[string, (store: ArbitrationStore) => void]>([
    [
      "update",
      (target) => {
        target.updated(onBandcamp("a.mp3"))
      },
    ],
    [
      "resolution",
      (target) => {
        target.resolved("a.mp3")
      },
    ],
    [
      "error",
      (target) => {
        target.rejected("a.mp3", "arbitration_busy")
      },
    ],
  ])("marks a track busy until its %s", (_answer, answer) => {
    queue("a.mp3")
    store.sent("a.mp3")
    const waiting = store.currentBusy()

    answer(store)

    expect(waiting).toBe(true)
    expect(store.isBusy("a.mp3")).toBe(false)
  })

  it("drops an arbitration the sidecar no longer holds", () => {
    queue("a.mp3", "b.mp3")

    store.rejected("a.mp3", "arbitration_not_pending")

    expect(queued()).toEqual(["b.mp3"])
  })

  it("keeps an arbitration rejected for another reason", () => {
    queue("a.mp3")

    store.rejected("a.mp3", "arbitration_candidate_unknown")

    expect(queued()).toEqual(["a.mp3"])
  })

  it("ignores an update for a track outside the queue", () => {
    queue("a.mp3")

    store.updated(onBandcamp("ghost.mp3"))

    expect(queued()).toEqual(["a.mp3"])
  })
})
