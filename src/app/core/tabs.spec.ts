import { DEFAULT_TAB, tabFromUrl } from "./tabs"

describe("tabFromUrl", () => {
  it("reads the tab from the first segment", () => {
    expect(tabFromUrl("/settings")).toBe("settings")
    expect(tabFromUrl("/tagging/")).toBe("tagging")
  })

  it("ignores the query and the fragment", () => {
    expect(tabFromUrl("/settings?run=3#report")).toBe("settings")
  })

  it("falls back to the first tab before the first navigation", () => {
    expect(tabFromUrl("/")).toBe(DEFAULT_TAB)
    expect(tabFromUrl("")).toBe(DEFAULT_TAB)
  })

  it("falls back to the first tab on a segment that is not a tab", () => {
    expect(tabFromUrl("/unknown")).toBe(DEFAULT_TAB)
  })
})
