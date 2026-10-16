import { formatBytes } from "./bytes"

describe("formatBytes", () => {
  it.each([
    [999, "999 byte"],
    [1_000, "1 kB"],
    [418_000_000, "418 MB"],
    [2_000_000_000, "2 GB"],
  ])("switches unit at each power of 1000 (%d)", (bytes, expected) => {
    expect(formatBytes(bytes, "en")).toBe(expected)
  })

  it.each([
    [999_499, "999 kB"],
    [999_999, "1 MB"],
    [999_999_999, "1 GB"],
  ])("moves to the next unit when the lower one would round to 1000 (%d)", (bytes, expected) => {
    expect(formatBytes(bytes, "en")).toBe(expected)
  })

  it("keeps one decimal below ten of a unit", () => {
    const formatted = formatBytes(1_500_000, "en")

    expect(formatted).toBe("1.5 MB")
  })
})
