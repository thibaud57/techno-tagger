import { DEFAULT_TAB, tabFromUrl } from "./tabs"

describe("tabFromUrl", () => {
  it.each([
    ["/settings", "settings"],
    ["/tagging/", "tagging"],
    ["/settings?run=3#report", "settings"],
  ])("reads the tab of %s", (url, tab) => {
    expect(tabFromUrl(url)).toBe(tab)
  })

  it.each(["/", "", "/unknown"])("falls back to the first tab for %j", (url) => {
    expect(tabFromUrl(url)).toBe(DEFAULT_TAB)
  })
})
