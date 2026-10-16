import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"
import { vi } from "vitest"

import { EMPTY_EXTRACTION } from "../../../fixtures/extraction"
import { type PreferencesStub, preferencesStub } from "../../../fixtures/preferences-stub"
import { type SidecarStub, provideSidecarStub, sidecarStub } from "../../../fixtures/sidecar-stub"
import { spyToast } from "../../../fixtures/toast"
import { translateWith } from "../../../fixtures/translate"
import {
  NETWORK_FINISHED,
  WRITE_FINISHED,
  failedRollback,
  rollbackFinished,
  writeFinishedWithFailures,
} from "../../../fixtures/write"
import { CompletionSignalService } from "./completion-signal.service"
import { PreferencesService } from "./preferences.service"

/**
 * Web Audio n'existe pas sous Vitest : le contexte est mocke pour verifier qu'un
 * son est bien demande, sans rien jouer.
 */
class FakeOscillator {
  started = false
  readonly frequency = { value: 0 }
  readonly connect = vi.fn()
  readonly stop = vi.fn()

  start(): void {
    this.started = true
  }
}

class FakeAudioContext {
  static readonly oscillators: FakeOscillator[] = []
  readonly currentTime = 0
  readonly destination = {}

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator()
    FakeAudioContext.oscillators.push(oscillator)

    return oscillator
  }

  createGain() {
    return {
      gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

describe("CompletionSignalService", () => {
  let service: CompletionSignalService
  let sidecar: SidecarStub
  let preferences: PreferencesStub
  let toast: ReturnType<typeof spyToast>

  const beeped = (): boolean =>
    FakeAudioContext.oscillators.some((oscillator) => oscillator.started)

  beforeEach(() => {
    FakeAudioContext.oscillators.length = 0
    vi.stubGlobal("AudioContext", FakeAudioContext)
    sidecar = sidecarStub()
    preferences = preferencesStub()
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        MessageService,
        provideSidecarStub(sidecar),
        { provide: PreferencesService, useValue: preferences },
      ],
    })
    service = TestBed.inject(CompletionSignalService)
    toast = spyToast()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    { case: "plays a sound and shows a toast", sound: true, audio: true, beeps: true },
    {
      case: "stays silent but still shows the toast when the sound preference is off",
      sound: false,
      audio: true,
      beeps: false,
    },
    {
      case: "shows the toast even when the audio context is unavailable",
      sound: true,
      audio: false,
      beeps: false,
    },
  ])("$case", async ({ sound, audio, beeps }) => {
    preferences.readSoundSignal.mockResolvedValue(sound)
    if (!audio) {
      vi.stubGlobal("AudioContext", undefined)
    }

    await service.announce("tagging.finished")

    expect(beeped()).toBe(beeps)
    expect(toast).toHaveBeenCalledOnce()
  })

  // Les effets du constructeur passent une premiere fois sur des signaux vides : seule une fin
  // posee ensuite doit s'annoncer, une fois, quel que soit l'ecran monte.
  it.each([
    {
      case: "an extraction",
      finish: () => {
        sidecar.extraction.set(EMPTY_EXTRACTION)
      },
      expected: { severity: "success", summary: "playlist.extractionFinished" },
    },
    {
      case: "a tagging search",
      finish: () => {
        sidecar.taggingFinished.set(NETWORK_FINISHED)
      },
      expected: { severity: "success", summary: "tagging.finished" },
    },
    {
      case: "a write",
      finish: () => {
        sidecar.writeFinished.set(WRITE_FINISHED)
      },
      expected: { severity: "success", summary: "tagging.writeFinished" },
    },
    {
      case: "a write that left failures",
      finish: () => {
        sidecar.writeFinished.set(writeFinishedWithFailures(2))
      },
      expected: { severity: "warn", summary: "2 failed" },
    },
    {
      case: "a rollback",
      finish: () => {
        sidecar.rollbackFinished.set(rollbackFinished())
      },
      expected: { severity: "success", summary: "tagging.rollbackFinished" },
    },
    {
      case: "a rollback that left a file as it was",
      finish: () => {
        sidecar.rollbackFinished.set(failedRollback())
      },
      expected: { severity: "warn", summary: "1 failed" },
    },
  ])("announces the end of $case once", async ({ finish, expected }) => {
    translateWith({
      tagging: {
        writeFinishedWithFailures: "{{count}} failed",
        rollbackFinishedWithFailures: "{{count}} failed",
      },
    })
    TestBed.tick()

    finish()
    TestBed.tick()

    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining(expected))
    })
    expect(toast).toHaveBeenCalledOnce()
  })

  it("announces the next run once its end replaces the reset one", async () => {
    TestBed.tick()

    sidecar.taggingFinished.set({ ...NETWORK_FINISHED, resolved: 1 })
    TestBed.tick()
    sidecar.taggingFinished.set(null)
    TestBed.tick()
    sidecar.taggingFinished.set({ ...NETWORK_FINISHED, resolved: 2 })
    TestBed.tick()

    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })
  })
})
