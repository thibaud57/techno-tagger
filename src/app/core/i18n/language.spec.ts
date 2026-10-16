import {
  FALLBACK_LANGUAGE,
  languageFromTag,
  resolveInitialLanguage,
  resolveStartupLanguage,
} from "./language"

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
  it.each([
    {
      case: "prefers the system locale when it answers",
      system: () => Promise.resolve("fr-FR"),
      browser: "de-DE",
      expected: "fr",
    },
    {
      case: "falls back to the browser when the system locale is null",
      system: () => Promise.resolve(null),
      browser: "fr-BE",
      expected: "fr",
    },
    {
      case: "falls back to the browser when the Tauri call rejects",
      system: () => Promise.reject(new TypeError("__TAURI_INTERNALS__ is undefined")),
      browser: "fr-FR",
      expected: "fr",
    },
    {
      case: "falls back to English when no source answers",
      system: () => Promise.reject(new TypeError("hors Tauri")),
      browser: "",
      expected: FALLBACK_LANGUAGE,
    },
  ])("$case", async ({ system, browser, expected }) => {
    const language = await resolveInitialLanguage(system, () => browser)

    expect(language).toBe(expected)
  })
})

describe("resolveStartupLanguage", () => {
  it.each([
    {
      case: "prefers the language chosen in the settings over the system locale",
      stored: "en",
      expected: "en",
    },
    {
      case: "lets the system locale decide until a language is chosen",
      stored: null,
      expected: "fr",
    },
  ] as const)("$case", async ({ stored, expected }) => {
    const language = await resolveStartupLanguage(
      () => Promise.resolve(stored),
      () => Promise.resolve("fr"),
    )

    expect(language).toBe(expected)
  })
})
