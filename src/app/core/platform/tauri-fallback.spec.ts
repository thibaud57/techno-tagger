import { vi } from "vitest"

import { withFallback } from "./tauri-fallback"

describe("withFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the call result", async () => {
    const result = await withFallback(() => Promise.resolve("ok"), "fallback")

    expect(result).toBe("ok")
  })

  it.each([
    { where: "outside Tauri", tauri: false, reports: 0 },
    { where: "inside Tauri", tauri: true, reports: 1 },
  ])("falls back $where, reporting only a real failure", async ({ tauri, reports }) => {
    const reported = vi.fn()
    vi.stubGlobal("isTauri", tauri)
    vi.stubGlobal("reportError", reported)

    const result = await withFallback(() => Promise.reject(new Error("disk full")), "fallback")

    expect(result).toBe("fallback")
    expect(reported).toHaveBeenCalledTimes(reports)
  })
})
