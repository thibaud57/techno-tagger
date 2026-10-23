import { TestBed } from "@angular/core/testing"

import { arbitrationRequired, arbitrationUpdated } from "../../../fixtures/tagging"
import { ArbitrationStore } from "./arbitration.store"

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

    store.updated(arbitrationUpdated("b.mp3"))

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

  it("stays on the first arbitration when asked for the one before it", () => {
    queue("a.mp3", "b.mp3")

    store.previous()

    expect(store.current()?.track_id).toBe("a.mp3")
    expect([store.hasPrevious(), store.hasNext()]).toEqual([false, true])
  })

  it("stays on the last arbitration when asked for the one after it", () => {
    queue("a.mp3", "b.mp3")

    store.next()
    store.next()

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

  it("marks a track busy once a gesture is sent", () => {
    queue("a.mp3")

    store.sent("a.mp3")

    expect(store.currentBusy()).toBe(true)
  })

  it.each<[string, (store: ArbitrationStore) => void]>([
    [
      "update",
      (target) => {
        target.updated(arbitrationUpdated("a.mp3"))
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
  ])("releases a busy track on its %s", (_answer, answer) => {
    queue("a.mp3")
    store.sent("a.mp3")

    answer(store)

    expect(store.isBusy("a.mp3")).toBe(false)
  })

  it("reports a gesture in flight on any track, not only the displayed one", () => {
    queue("a.mp3", "b.mp3")

    store.sent("b.mp3")

    expect(store.anyBusy()).toBe(true)
    expect(store.currentBusy()).toBe(false)
  })

  it("reports no gesture in flight once the answer is in", () => {
    queue("a.mp3", "b.mp3")
    store.sent("b.mp3")

    store.resolved("b.mp3")

    expect(store.anyBusy()).toBe(false)
  })

  it.each([
    {
      case: "drops an arbitration the sidecar no longer holds",
      trackIds: ["a.mp3", "b.mp3"],
      code: "arbitration_not_pending",
      remaining: ["b.mp3"],
      expected: true,
    },
    {
      case: "keeps an arbitration rejected for another reason",
      trackIds: ["a.mp3"],
      code: "arbitration_candidate_unknown",
      remaining: ["a.mp3"],
      expected: false,
    },
  ])("$case", ({ trackIds, code, remaining, expected }) => {
    queue(...trackIds)

    const dropped = store.rejected("a.mp3", code)

    expect(queued()).toEqual(remaining)
    expect(dropped).toBe(expected)
  })

  it("ignores an update for a track outside the queue", () => {
    queue("a.mp3")

    store.updated(arbitrationUpdated("ghost.mp3"))

    expect(queued()).toEqual(["a.mp3"])
  })
})
