import { signal, type WritableSignal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { load, type Store } from "@tauri-apps/plugin-store"
import { MessageService } from "primeng/api"

import { CompletionSignalService } from "./completion-signal.service"
import { SidecarService } from "./sidecar.service"

// `readSoundSignal` ne lit pas la preference lui-meme, il la lit par `load()` de ce
// paquet npm : le piloter ici est le pattern deja eprouve par preferences.spec.ts et
// playlist-page.component.spec.ts, et evite de mocker un import relatif du code de
// l'app, que le builder unit-test d'Angular interdit ("Cannot redefine property" pour
// vi.spyOn, garde explicite pour vi.mock).
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

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
  let messages: MessageService
  let extraction: WritableSignal<object | null>
  let taggingFinished: WritableSignal<object | null>

  /** Les effets du constructeur passent une premiere fois, `announce` espionne. */
  const watchPhaseEnds = () => {
    const announce = vi.spyOn(service, "announce").mockResolvedValue()
    TestBed.tick()

    return announce
  }

  beforeEach(() => {
    FakeAudioContext.oscillators.length = 0
    vi.stubGlobal("AudioContext", FakeAudioContext)
    extraction = signal(null)
    taggingFinished = signal(null)
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        MessageService,
        { provide: SidecarService, useValue: { extraction, taggingFinished } },
      ],
    })
    service = TestBed.inject(CompletionSignalService)
    messages = TestBed.inject(MessageService)
  })

  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it("plays a sound and shows a toast when a phase ends", async () => {
    vi.mocked(load).mockResolvedValue({ get: vi.fn().mockResolvedValue(true) } as unknown as Store)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators.some((oscillator) => oscillator.started)).toBe(true)
    expect(add).toHaveBeenCalled()
  })

  it("stays silent when the sound preference is off but still shows the toast", async () => {
    vi.mocked(load).mockResolvedValue({ get: vi.fn().mockResolvedValue(false) } as unknown as Store)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators).toEqual([])
    expect(add).toHaveBeenCalled()
  })

  it("announces each phase end once, without any screen mounted", () => {
    const announce = watchPhaseEnds()

    extraction.set({})
    TestBed.tick()
    taggingFinished.set({})
    TestBed.tick()

    expect(announce.mock.calls).toEqual([["playlist.extractionFinished"], ["tagging.finished"]])
  })

  it("announces the next run once its end replaces the reset one", () => {
    const announce = watchPhaseEnds()

    taggingFinished.set({ resolved: 1 })
    TestBed.tick()
    taggingFinished.set(null)
    TestBed.tick()
    taggingFinished.set({ resolved: 2 })
    TestBed.tick()

    expect(announce).toHaveBeenCalledTimes(2)
  })

  it("shows the toast even when the audio context is unavailable", async () => {
    vi.mocked(load).mockResolvedValue({ get: vi.fn().mockResolvedValue(true) } as unknown as Store)
    vi.stubGlobal("AudioContext", undefined)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(add).toHaveBeenCalled()
  })
})
