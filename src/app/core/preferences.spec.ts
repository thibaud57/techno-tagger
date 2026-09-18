import { load, type Store } from "@tauri-apps/plugin-store"

import { DEFAULT_EXTRACTION_MODE, readExtractionMode } from "./preferences"

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

describe("preferences", () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it("restores a stored move mode", async () => {
    const store = {
      get: vi.fn().mockResolvedValue("move"),
    } as unknown as Store

    vi.mocked(load).mockResolvedValue(store)

    const result = await readExtractionMode()

    expect(result).toBe("move")
  })

  it("falls back to copy on an unreadable stored value", async () => {
    const store = {
      get: vi.fn().mockResolvedValue(42),
    } as unknown as Store

    vi.mocked(load).mockResolvedValue(store)

    const result = await readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })

  it("falls back to copy when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })
})
