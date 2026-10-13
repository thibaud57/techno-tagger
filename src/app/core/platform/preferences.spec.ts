import { load } from "@tauri-apps/plugin-store"

import { storeStub } from "../../../fixtures/tauri-store"
import {
  DEFAULT_EXTRACTION_MODE,
  DEFAULT_SOUND_SIGNAL,
  readExtractionMode,
  readSoundSignal,
} from "./preferences"

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

describe("preferences", () => {
  it("restores a stored move mode", async () => {
    vi.mocked(load).mockResolvedValue(storeStub("move"))

    const result = await readExtractionMode()

    expect(result).toBe("move")
  })

  it("falls back to copy on an unreadable stored value", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(42))

    const result = await readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })

  it("falls back to copy when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })

  it("falls back to the sound signal default when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await readSoundSignal()

    expect(result).toBe(DEFAULT_SOUND_SIGNAL)
  })
})
