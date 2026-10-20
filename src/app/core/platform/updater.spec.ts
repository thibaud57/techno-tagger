import { progressAfter, releasePageOf } from "./updater"

const manifest = (url: unknown): Record<string, unknown> => ({
  version: "2.0.0",
  platforms: { "windows-x86_64": { signature: "sig", url } },
})

describe("releasePageOf", () => {
  it("derives the release page from the installer url", () => {
    const url = "https://github.com/acme/app/releases/download/v2.0.0/app_2.0.0_x64-setup.exe"

    const page = releasePageOf(manifest(url))

    expect(page).toBe("https://github.com/acme/app/releases/tag/v2.0.0")
  })

  it.each([
    ["another host", manifest("https://example.com/app_2.0.0_x64-setup.exe")],
    ["a url that is not a string", manifest(42)],
    ["a manifest without a Windows entry", { version: "2.0.0", platforms: {} }],
  ])("derives no release page from %s", (_, raw) => {
    const page = releasePageOf(raw)

    expect(page).toBeNull()
  })
})

describe("progressAfter", () => {
  it("adds each chunk to the bytes received", () => {
    const started = progressAfter(
      { received: 0, total: null },
      { event: "Started", data: { contentLength: 10 } },
    )
    const progressed = progressAfter(started, { event: "Progress", data: { chunkLength: 4 } })

    const progress = progressAfter(progressed, { event: "Progress", data: { chunkLength: 3 } })

    expect(progress).toEqual({ received: 7, total: 10 })
  })

  it("keeps an unknown total as null", () => {
    const progress = progressAfter({ received: 0, total: null }, { event: "Started", data: {} })

    expect(progress).toEqual({ received: 0, total: null })
  })
})
