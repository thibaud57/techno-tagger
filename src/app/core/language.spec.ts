import { FALLBACK_LANGUAGE, languageFromTag, resolveInitialLanguage } from "./language"

describe("languageFromTag", () => {
  it("resolves French from a regional tag", () => {
    expect(languageFromTag("fr-FR")).toBe("fr")
  })

  it("resolves French from a tag without region", () => {
    expect(languageFromTag("fr")).toBe("fr")
  })

  it("matches on the prefix, not on equality", () => {
    expect(languageFromTag("fr-BE")).toBe("fr")
    expect(languageFromTag("fr-Latn-FR")).toBe("fr")
  })

  it("resolves English for any other language", () => {
    expect(languageFromTag("de-DE")).toBe("en")
    expect(languageFromTag("en-US")).toBe("en")
  })

  it("ignores the tag case", () => {
    expect(languageFromTag("FR-fr")).toBe("fr")
  })

  it("resolves English for a missing or empty value", () => {
    expect(languageFromTag(null)).toBe(FALLBACK_LANGUAGE)
    expect(languageFromTag(undefined)).toBe(FALLBACK_LANGUAGE)
    expect(languageFromTag("")).toBe(FALLBACK_LANGUAGE)
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
