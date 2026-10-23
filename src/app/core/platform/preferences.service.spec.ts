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

  it.each([
    { case: "restores a stored move mode", stored: "move", expected: "move" },
    {
      case: "falls back to copy on an unreadable stored value",
      stored: 42,
      expected: DEFAULT_EXTRACTION_MODE,
    },
  ])("$case", async ({ stored, expected }) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await service.readExtractionMode()

    expect(result).toBe(expected)
  })

  it.each<{
    case: string
    read: (target: PreferencesService) => Promise<unknown>
    fallback: unknown
  }>([
    {
      case: "falls back to copy when the store cannot be loaded",
      read: (target) => target.readExtractionMode(),
      fallback: DEFAULT_EXTRACTION_MODE,
    },
    {
      case: "falls back to the sound signal default when the store cannot be loaded",
      read: (target) => target.readSoundSignal(),
      fallback: DEFAULT_SOUND_SIGNAL,
    },
  ])("$case", async ({ read, fallback }) => {
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    const result = await read(service)

    expect(result).toBe(fallback)
  })

  it.each([
    { case: "reads a stored language the application offers", stored: "en", expected: "en" },
    {
      case: "ignores a stored language the application does not offer",
      stored: "de",
      expected: null,
    },
  ])("$case", async ({ stored, expected }) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await service.readLanguage()

    expect(result).toBe(expected)
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

  it.each([
    ["without a target version", { from: "1.0.0" }],
    ["with a version that is not a string", { from: 1, to: "2.0.0" }],
    ["with an empty version", { from: "", to: "2.0.0" }],
    ["not an object", "1.0.0"],
  ])("ignores a malformed stored update attempt %s", async (_case, stored) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await service.readUpdateAttempt()

    expect(result).toBeNull()
  })

  // Les cles vivent dans le fichier de l'utilisateur : en renommer une lui ferait perdre son reglage.
  it.each<[string, (target: PreferencesService) => Promise<void>, unknown]>([
    ["extraction_mode", (target) => target.writeExtractionMode("move"), "move"],
    ["sound_signal", (target) => target.writeSoundSignal(false), false],
    ["language", (target) => target.writeLanguage("fr"), "fr"],
    ["last_destination", (target) => target.writeLastDestination("C:/work"), "C:/work"],
    ["thresholds", (target) => target.writeThresholds(CUSTOM_THRESHOLDS), CUSTOM_THRESHOLDS],
    [
      "update_attempt",
      (target) => target.writeUpdateAttempt({ from: "1.0.0", to: "2.0.0" }),
      { from: "1.0.0", to: "2.0.0" },
    ],
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
