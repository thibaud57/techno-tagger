import { TestBed } from "@angular/core/testing"

import { urlRecoveryError } from "../../fixtures/url-recovery"
import { UrlRecoveryStore } from "./url-recovery.store"

describe("UrlRecoveryStore", () => {
  let store: UrlRecoveryStore

  beforeEach(() => {
    store = TestBed.inject(UrlRecoveryStore)
  })

  it("opens on the first progress", () => {
    const closed = store.progress()

    store.advanced(0, 2)

    expect(closed).toBeNull()
    expect(store.progress()).toEqual({ processed: 0, total: 2 })
  })

  it.each<[string, (target: UrlRecoveryStore) => void]>([
    [
      "resolution",
      (target) => {
        target.resolved("a.mp3")
      },
    ],
    [
      "error",
      (target) => {
        target.rejected("a.mp3", urlRecoveryError("a.mp3"))
      },
    ],
  ])("marks a track busy until its %s", (_answer, answer) => {
    store.sent("a.mp3")
    store.sent("b.mp3")
    const waiting = store.isBusy("a.mp3")

    answer(store)

    expect(waiting).toBe(true)
    expect(store.isBusy("a.mp3")).toBe(false)
    expect(store.isBusy("b.mp3")).toBe(true)
  })

  it("keeps the error of a track until its next gesture", () => {
    const error = urlRecoveryError("a.mp3")
    store.rejected("a.mp3", error)
    const kept = store.errors().get("a.mp3")

    store.sent("a.mp3")

    expect(kept).toEqual(error)
    expect(store.errors().has("a.mp3")).toBe(false)
  })

  it("clears the phase", () => {
    store.advanced(1, 2)
    store.sent("a.mp3")
    store.rejected("b.mp3", urlRecoveryError("b.mp3"))

    store.clear()

    expect([store.progress(), store.busy().size, store.errors().size]).toEqual([null, 0, 0])
  })
})
