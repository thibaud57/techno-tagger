import { DEFAULT_TAB, isTabRoot, tabFromUrl } from "./tabs"

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

describe("isTabRoot", () => {
  it.each(["/tagging", "/tagging/", "/tagging?run=3#report", "/"])(
    "is the base route of its tab: %s",
    (url) => {
      expect(isTabRoot(url)).toBe(true)
    },
  )

  it.each(["/tagging/recap", "/tagging/recap/a3f9c1", "/tagging/recap?filter=failed"])(
    "is a subpage of its tab: %s",
    (url) => {
      expect(isTabRoot(url)).toBe(false)
    },
  )
})
