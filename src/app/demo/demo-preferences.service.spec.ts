import { TestBed } from "@angular/core/testing"

import { DemoPreferencesService } from "./demo-preferences.service"

describe("DemoPreferencesService", () => {
  let preferences: DemoPreferencesService

  beforeEach(() => {
    localStorage.clear()
    TestBed.configureTestingModule({ providers: [DemoPreferencesService] })
    preferences = TestBed.inject(DemoPreferencesService)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("keeps preferences in memory when storage is refused", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied")
    })

    await preferences.writeLanguage("en")

    expect(await preferences.readLanguage()).toBe("en")
  })

  it("ignores a stored language outside fr and en", async () => {
    localStorage.setItem("techno-tagger-demo:language", JSON.stringify("xx"))

    const language = await preferences.readLanguage()

    expect(language).toBeNull()
  })

  it("saves the language of the query over the stored choice", async () => {
    localStorage.setItem("techno-tagger-demo:language", JSON.stringify("fr"))
    window.history.replaceState(null, "", "/?lang=en")

    const language = await preferences.readLanguage()

    expect(language).toBe("en")
    expect(localStorage.getItem("techno-tagger-demo:language")).toBe(JSON.stringify("en"))
  })

  it("restores a written sound signal under the demo prefix", async () => {
    await preferences.writeSoundSignal(false)

    expect(localStorage.getItem("techno-tagger-demo:sound_signal")).toBe("false")
    expect(await preferences.readSoundSignal()).toBe(false)
  })
})
