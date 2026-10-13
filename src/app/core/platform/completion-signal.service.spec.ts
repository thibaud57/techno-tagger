import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { load } from "@tauri-apps/plugin-store"
import { MessageService } from "primeng/api"

import { EMPTY_EXTRACTION } from "../../../fixtures/extraction"
import { type SidecarStub, sidecarStub } from "../../../fixtures/sidecar-stub"
import { storeStub } from "../../../fixtures/tauri-store"
import {
  NETWORK_FINISHED,
  WRITE_FINISHED,
  failedRollback,
  rollbackFinished,
} from "../../../fixtures/write"
import { SidecarService } from "../sidecar/sidecar.service"
import { CompletionSignalService } from "./completion-signal.service"

// `readSoundSignal` passe par `load()` de ce paquet npm : on pilote celui-ci plutot que de
// mocker un import relatif du code de l'app, que le builder unit-test d'Angular interdit
// ("Cannot redefine property" pour vi.spyOn, garde explicite pour vi.mock).
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
  let sidecar: SidecarStub

  /** Les effets du constructeur passent une premiere fois, `announce` espionne. */
  const watchPhaseEnds = () => {
    const announce = vi.spyOn(service, "announce").mockResolvedValue()
    TestBed.tick()

    return announce
  }

  beforeEach(() => {
    FakeAudioContext.oscillators.length = 0
    vi.stubGlobal("AudioContext", FakeAudioContext)
    sidecar = sidecarStub()
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        MessageService,
        { provide: SidecarService, useValue: sidecar },
      ],
    })
    service = TestBed.inject(CompletionSignalService)
    messages = TestBed.inject(MessageService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("plays a sound and shows a toast when a phase ends", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(true))
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators.some((oscillator) => oscillator.started)).toBe(true)
    expect(add).toHaveBeenCalled()
  })

  it("stays silent when the sound preference is off but still shows the toast", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(false))
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators).toEqual([])
    expect(add).toHaveBeenCalled()
  })

  it("announces each phase end once, without any screen mounted", () => {
    const announce = watchPhaseEnds()

    sidecar.extraction.set(EMPTY_EXTRACTION)
    TestBed.tick()
    sidecar.taggingFinished.set(NETWORK_FINISHED)
    TestBed.tick()

    expect(announce.mock.calls).toEqual([["playlist.extractionFinished"], ["tagging.finished"]])
  })

  it("announces the next run once its end replaces the reset one", () => {
    const announce = watchPhaseEnds()

    sidecar.taggingFinished.set({ ...NETWORK_FINISHED, resolved: 1 })
    TestBed.tick()
    sidecar.taggingFinished.set(null)
    TestBed.tick()
    sidecar.taggingFinished.set({ ...NETWORK_FINISHED, resolved: 2 })
    TestBed.tick()

    expect(announce).toHaveBeenCalledTimes(2)
  })

  it("announces a write end, with its failures when there are some", () => {
    const announce = watchPhaseEnds()

    sidecar.writeFinished.set({ ...WRITE_FINISHED })
    TestBed.tick()
    sidecar.writeFinished.set({ ...WRITE_FINISHED, written: 0, write_error: 2 })
    TestBed.tick()

    expect(announce.mock.calls).toEqual([
      ["tagging.writeFinished"],
      ["tagging.writeFinishedWithFailures", { count: 2 }, "warn"],
    ])
  })

  it("announces a rollback end, with its failures when there are some", () => {
    const announce = watchPhaseEnds()

    sidecar.rollbackFinished.set(rollbackFinished())
    TestBed.tick()
    sidecar.rollbackFinished.set(failedRollback())
    TestBed.tick()

    expect(announce.mock.calls).toEqual([
      ["tagging.rollbackFinished"],
      ["tagging.rollbackFinishedWithFailures", { count: 1 }, "warn"],
    ])
  })

  it("shows a warning toast when told so", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(false))
    const add = vi.spyOn(messages, "add")
    const instant = vi.spyOn(TestBed.inject(TranslateService), "instant")

    await service.announce("tagging.writeFinishedWithFailures", { count: 2 }, "warn")

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: "warn" }))
    expect(instant).toHaveBeenCalledWith("tagging.writeFinishedWithFailures", { count: 2 })
  })

  it("shows the toast even when the audio context is unavailable", async () => {
    vi.mocked(load).mockResolvedValue(storeStub(true))
    vi.stubGlobal("AudioContext", undefined)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(add).toHaveBeenCalled()
  })
})
