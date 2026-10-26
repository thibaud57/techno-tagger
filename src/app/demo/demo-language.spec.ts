import { takeLanguageFromQuery } from "./demo-language"

describe("takeLanguageFromQuery", () => {
  it.each([
    {
      case: "takes fr from the query and removes the parameter",
      search: "?lang=fr&x=1",
      language: "fr",
      url: "/playlist?x=1",
    },
    {
      case: "takes en from the query and removes the parameter",
      search: "?lang=en&x=1",
      language: "en",
      url: "/playlist?x=1",
    },
    {
      case: "ignores an unknown language and still removes the parameter",
      search: "?lang=de",
      language: null,
      url: "/playlist",
    },
  ])("$case", ({ search, language, url }) => {
    const replaceState = vi.fn()

    const taken = takeLanguageFromQuery(
      { search, pathname: "/playlist", hash: "" },
      { replaceState },
    )

    expect(taken).toBe(language)
    expect(replaceState).toHaveBeenCalledWith(null, "", url)
  })

  it("returns nothing when the query carries no language", () => {
    const replaceState = vi.fn()

    const taken = takeLanguageFromQuery(
      { search: "", pathname: "/playlist", hash: "" },
      { replaceState },
    )

    expect(taken).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })
})
