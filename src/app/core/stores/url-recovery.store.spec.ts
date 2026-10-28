import { TestBed } from "@angular/core/testing"

import { urlRecoveryError } from "../../../fixtures/url-recovery"
import { UrlRecoveryStore } from "./url-recovery.store"

describe("UrlRecoveryStore", () => {
  let store: UrlRecoveryStore

  beforeEach(() => {
    store = TestBed.inject(UrlRecoveryStore)
  })

  it("is closed before the first progress", () => {
    expect(store.progress()).toBeNull()
  })

  it("opens on the first progress", () => {
    store.advanced(0, 2)

    expect(store.progress()).toEqual({ processed: 0, total: 2 })
  })

  it("marks a track busy once a gesture is sent", () => {
    store.sent("a.mp3")

    expect(store.isBusy("a.mp3")).toBe(true)
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
  ])("releases only the answered track on its %s", (_answer, answer) => {
    store.sent("a.mp3")
    store.sent("b.mp3")

    answer(store)

    expect(store.isBusy("a.mp3")).toBe(false)
    expect(store.isBusy("b.mp3")).toBe(true)
  })

  it("reports the recovery of a track whose gesture was in flight", () => {
    store.sent("a.mp3")

    store.resolved("a.mp3")

    expect(store.recovered()).toEqual({ trackId: "a.mp3" })
  })

  it("reports no recovery for a track resolved without a gesture", () => {
    store.resolved("a.mp3")

    expect(store.recovered()).toBeNull()
  })

  it("keeps the error of a track", () => {
    const error = urlRecoveryError("a.mp3")

    store.rejected("a.mp3", error)

    expect(store.errors().get("a.mp3")).toEqual(error)
  })

  it("forgets the error of a track at its next gesture", () => {
    store.rejected("a.mp3", urlRecoveryError("a.mp3"))

    store.sent("a.mp3")

    expect(store.errors().has("a.mp3")).toBe(false)
  })

  it("clears the phase", () => {
    store.advanced(1, 2)
    store.sent("a.mp3")
    store.sent("c.mp3")
    store.resolved("c.mp3")
    store.rejected("b.mp3", urlRecoveryError("b.mp3"))

    store.clear()

    expect([store.progress(), store.busy().size, store.errors().size, store.recovered()]).toEqual([
      null,
      0,
      0,
      null,
    ])
  })
})
