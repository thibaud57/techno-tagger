import { FALLBACK_LANGUAGE, languageFromTag, resolveInitialLanguage } from "./language"

describe("languageFromTag", () => {
  it.each([
    ["a regional tag", "fr-FR"],
    ["a tag without region", "fr"],
    ["another region, matching on the prefix", "fr-BE"],
    ["a script subtag, matching on the prefix", "fr-Latn-FR"],
    ["a tag in another case", "FR-fr"],
  ])("resolves French from %s", (_case, tag) => {
    expect(languageFromTag(tag)).toBe("fr")
  })

  it.each(["de-DE", "en-US"])("resolves English from %s", (tag) => {
    expect(languageFromTag(tag)).toBe("en")
  })

  it.each([null, undefined, ""])("resolves English for the missing value %j", (tag) => {
    expect(languageFromTag(tag)).toBe(FALLBACK_LANGUAGE)
  })
})

describe("resolveInitialLanguage", () => {
  it("prefers the system locale when it answers", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.resolve("fr-FR"),
      () => "de-DE",
    )

    expect(language).toBe("fr")
  })

  it("falls back to the browser when the system locale is null", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.resolve(null),
      () => "fr-BE",
    )

    expect(language).toBe("fr")
  })

  it("falls back to the browser when the Tauri call rejects", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.reject(new TypeError("__TAURI_INTERNALS__ is undefined")),
      () => "fr-FR",
    )

    expect(language).toBe("fr")
  })

  it("falls back to English when no source answers", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.reject(new TypeError("hors Tauri")),
      () => "",
    )

    expect(language).toBe(FALLBACK_LANGUAGE)
  })
})
