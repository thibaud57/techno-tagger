import { TestBed } from "@angular/core/testing"

import { INTERRUPTED } from "../../../fixtures/resume"

import { ResumeStore } from "./resume.store"

describe("ResumeStore", () => {
  let store: ResumeStore

  beforeEach(() => {
    store = TestBed.inject(ResumeStore)
  })

  it("prompts the announced run", () => {
    store.announced(INTERRUPTED)

    const prompt = store.prompt()

    expect(prompt).toEqual(INTERRUPTED)
  })

  it("prompts nothing once the engine announces no run", () => {
    store.announced(INTERRUPTED)

    store.announced(null)

    expect(store.prompt()).toBeNull()
  })

  it("closes the prompt at the gesture and opens it again on the next announcement", () => {
    store.announced(INTERRUPTED)
    store.cleared()
    const closed = store.prompt()

    store.announced({ ...INTERRUPTED, run_id: "1b2c3d" })

    expect(closed).toBeNull()
    expect(store.prompt()?.run_id).toBe("1b2c3d")
  })
})
