import { TestBed } from "@angular/core/testing"
import { type Store, load } from "@tauri-apps/plugin-store"
import { vi } from "vitest"

import { CUSTOM_THRESHOLDS } from "../../../fixtures/settings"
import {
  DEFAULT_EXTRACTION_MODE,
  DEFAULT_SOUND_SIGNAL,
  PreferencesService,
} from "./preferences.service"

// Seul spec qui mocke le plugin : `PreferencesService` en est l'adaptateur, les autres specs le
// remplacent par `preferencesStub`.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

// Le vrai `Store` a un constructeur prive : un stub ne peut que s'y faire passer.
const storeStub = (value?: unknown): Store =>
  ({
    get: vi.fn(() => Promise.resolve(value)),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
  }) as unknown as Store

describe("PreferencesService", () => {
  let service: PreferencesService

  beforeEach(() => {
    service = TestBed.inject(PreferencesService)
  })

  it("restores a stored move mode", async () => {
    vi.mocked(load).mockResolvedValue(storeStub("move"))

    const result = await service.readExtractionMode()

    expect(result).toBe("move")
  })

  it("falls back to copy on an unreadable stored value", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(42))

    const result = await service.readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })

  it("falls back to copy when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await service.readExtractionMode()

    expect(result).toBe(DEFAULT_EXTRACTION_MODE)
  })

  it("falls back to the sound signal default when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await service.readSoundSignal()

    expect(result).toBe(DEFAULT_SOUND_SIGNAL)
  })

  it("reads a stored language the application offers", async () => {
    vi.mocked(load).mockResolvedValue(storeStub("en"))

    const result = await service.readLanguage()

    expect(result).toBe("en")
  })

  it("ignores a stored language the application does not offer", async () => {
    vi.mocked(load).mockResolvedValue(storeStub("de"))

    const result = await service.readLanguage()

    expect(result).toBeNull()
  })

  it.each([
    ["inside the score scale", CUSTOM_THRESHOLDS],
    ["on the bounds of the score scale", { floor: 0, ceiling: 100 }],
    ["equal to each other", { floor: 80, ceiling: 80 }],
  ])("restores stored thresholds %s", async (_case, stored) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await service.readThresholds()

    expect(result).toEqual(stored)
  })

  it.each([
    ["crossed", { floor: 95, ceiling: 72 }],
    ["below the score scale", { floor: -1, ceiling: 95 }],
    ["above the score scale", { floor: 72, ceiling: 120 }],
    ["not numbers", { floor: "72", ceiling: 95 }],
    ["not an object", "72-95"],
  ])("ignores stored thresholds that are %s", async (_case, stored) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await service.readThresholds()

    expect(result).toBeNull()
  })

  // Les cles vivent dans le fichier de l'utilisateur : en renommer une lui ferait perdre son reglage.
  it.each<[string, (target: PreferencesService) => Promise<void>, unknown]>([
    ["extraction_mode", (target) => target.writeExtractionMode("move"), "move"],
    ["sound_signal", (target) => target.writeSoundSignal(false), false],
    ["language", (target) => target.writeLanguage("fr"), "fr"],
    ["last_destination", (target) => target.writeLastDestination("C:/work"), "C:/work"],
    ["thresholds", (target) => target.writeThresholds(CUSTOM_THRESHOLDS), CUSTOM_THRESHOLDS],
  ])("writes the %s preference under its key", async (key, write, expected) => {
    const store = storeStub()
    vi.mocked(load).mockResolvedValue(store)

    await write(service)

    expect(store.set).toHaveBeenCalledWith(key, expected)
  })

  it("saves the store after a write", async () => {
    const store = storeStub()
    vi.mocked(load).mockResolvedValue(store)

    await service.writeSoundSignal(false)

    expect(store.save).toHaveBeenCalledOnce()
  })

  it("does not throw when the store cannot be loaded", async () => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = service.writeSoundSignal(false)

    await expect(result).resolves.toBeUndefined()
  })
})
