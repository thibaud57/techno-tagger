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

  it.each<[string, (target: ResumeStore) => void]>([
    [
      "the engine announces no run",
      (target) => {
        target.announced(null)
      },
    ],
    [
      "the gesture closes it",
      (target) => {
        target.cleared()
      },
    ],
  ])("prompts nothing once %s", (_when, end) => {
    store.announced(INTERRUPTED)

    end(store)

    expect(store.prompt()).toBeNull()
  })

  it("opens the prompt again on the next announcement", () => {
    store.announced(INTERRUPTED)
    store.cleared()

    store.announced({ ...INTERRUPTED, run_id: "1b2c3d" })

    expect(store.prompt()?.run_id).toBe("1b2c3d")
  })
})
