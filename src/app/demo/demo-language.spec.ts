import { takeLanguageFromQuery } from "./demo-language"

describe("takeLanguageFromQuery", () => {
  it.each(["fr", "en"] as const)("takes %s from the query and removes the parameter", (lang) => {
    const replaceState = vi.fn()

    const taken = takeLanguageFromQuery(
      { search: `?lang=${lang}&x=1`, pathname: "/playlist", hash: "" },
      { replaceState },
    )

    expect(taken).toBe(lang)
    expect(replaceState).toHaveBeenCalledWith(null, "", "/playlist?x=1")
  })

  it("ignores an unknown language and still removes the parameter", () => {
    const replaceState = vi.fn()

    const taken = takeLanguageFromQuery(
      { search: "?lang=de", pathname: "/playlist", hash: "" },
      { replaceState },
    )

    expect(taken).toBeNull()
    expect(replaceState).toHaveBeenCalledWith(null, "", "/playlist")
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
