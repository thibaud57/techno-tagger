import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { load, type Store } from "@tauri-apps/plugin-store"

import { CompletionSignalService } from "../../core/completion-signal.service"
import type { SidecarErrorEvent } from "../../core/models/protocol"
import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"

import TaggingPageComponent from "./tagging-page.component"

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
}))

/**
 * `readLastDestination` ne lit pas la preference elle-meme, elle passe par `load()` de ce
 * paquet npm : le piloter ici est le pattern deja eprouve par preferences.spec.ts et
 * completion-signal.service.spec.ts, et evite de mocker un import relatif du code de l'app,
 * que le builder unit-test d'Angular interdit.
 */
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

/**
 * Ce qui se teste ici est la disponibilite du lancement, la commande emise et le
 * declenchement unique du signal : le reste de l'ecran affiche ce qu'il recoit.
 *
 * Le constructeur declenche `prefill()` sans l'attendre. Rappeler `readLastDestination()`
 * ici, sur le meme mock, attend deterministement que cette promesse en vol se resolve avant
 * de rendre la main au test : sans cette barriere, elle peut se resoudre pendant la suite
 * d'un AUTRE fichier de spec (le builder unit-test d'Angular partage l'environnement entre
 * fichiers par defaut, `isolate` valant `false`) et perturber son mock de
 * `@tauri-apps/plugin-store`, par exemple celui de preferences.spec.ts.
 */
const mountWith = async (overrides: Partial<Record<string, unknown>> = {}) => {
  const service = {
    ready: signal(true),
    available: signal(true),
    apiKeyConfigured: signal(true),
    tagging: signal(false),
    extracting: signal(false),
    taggingTracks: signal([]),
    taggingProgress: signal(null),
    taggingFinished: signal(null),
    lastError: signal(null),
    lastErrorCommand: signal(null),
    errorFor: SidecarService.prototype.errorFor,
    startTagging: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  // `announceOnTransition` reste la vraie implementation du service : c'est elle qui porte
  // la garde testee plus bas, et `this` a l'interieur s'y lie a cet objet (methode non liee).
  const announce = {
    announce: vi.fn(() => Promise.resolve()),
    announceOnTransition: CompletionSignalService.prototype.announceOnTransition,
  }

  vi.mocked(load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
  } as unknown as Store)

  TestBed.configureTestingModule({
    imports: [TaggingPageComponent],
    providers: [
      provideTranslateService(),
      { provide: SidecarService, useValue: service },
      { provide: CompletionSignalService, useValue: announce },
    ],
  })

  const fixture = TestBed.createComponent(TaggingPageComponent)
  await readLastDestination()

  return { fixture, component: fixture.componentInstance, service, announce }
}

describe("TaggingPageComponent", () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it("prefills the folder with the destination of the last extraction", async () => {
    const { component, fixture } = await mountWith()

    await fixture.whenStable()

    expect(component["folder"]()).toBe("D:/Sets/Aout")
  })

  it.each([
    ["without a folder", { folder: "" }],
    ["without an api key", { apiKeyConfigured: signal(false) }],
    ["during a run", { tagging: signal(true) }],
  ])("disables the launch %s", async (_name, overrides) => {
    const folder = "folder" in overrides ? overrides.folder : "D:/Sets/Aout"
    const { component } = await mountWith("folder" in overrides ? {} : overrides)
    component["folder"].set(folder)

    const enabled = component["canStart"]()

    expect(enabled).toBe(false)
  })

  it("sends the start tagging command with the chosen folder", async () => {
    const { component, service } = await mountWith()
    component["folder"].set("D:/Sets/Aout")

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith("D:/Sets/Aout")
  })

  it("announces the end of the network phase only once", async () => {
    const finished = signal<{ resolved: number } | null>(null)
    const { fixture, announce } = await mountWith({ taggingFinished: finished })

    finished.set({ resolved: 1 })
    fixture.detectChanges()
    fixture.detectChanges()

    expect(announce.announce).toHaveBeenCalledTimes(1)

    // Nouveau run : le store remet `taggingFinished` a null (`reset()`) avant de le
    // reposer a la fin de la phase reseau suivante (`completed()`).
    finished.set(null)
    fixture.detectChanges()
    finished.set({ resolved: 2 })
    fixture.detectChanges()

    expect(announce.announce).toHaveBeenCalledTimes(2)
  })

  it("does not announce a finished run that was already there when the tab mounts", async () => {
    const finished = signal<{ resolved: number } | null>({ resolved: 1 })
    const { fixture, announce } = await mountWith({ taggingFinished: finished })

    fixture.detectChanges()
    fixture.detectChanges()

    expect(announce.announce).not.toHaveBeenCalled()
  })

  it("names the run in progress first, ahead of every other cause", async () => {
    const { component } = await mountWith({
      tagging: signal(true),
      apiKeyConfigured: signal(false),
    })

    expect(component["blockedReason"]()).toBe("tagging.blocked.running")
  })

  it.each([
    ["shows an error raised by its own command", "start_tagging", "api_key_rejected"],
    ["ignores an error raised by another screen", "set_api_key", null],
  ] as const)("%s", async (_name, command, expected) => {
    const failure: SidecarErrorEvent = {
      event: "error",
      code: "api_key_rejected",
      params: {},
      message: "",
      command,
    }
    const { component } = await mountWith({
      lastError: signal(failure),
      lastErrorCommand: signal(command),
    })

    const shown = component["error"]()

    expect(shown?.code ?? null).toBe(expected)
  })

  it("names the missing api key ahead of the folder", async () => {
    const { component } = await mountWith({ apiKeyConfigured: signal(false) })

    expect(component["blockedReason"]()).toBe("tagging.blocked.api_key")
  })

  it("names the missing folder once the api key is configured", async () => {
    const { component } = await mountWith()
    component["folder"].set("")

    expect(component["blockedReason"]()).toBe("tagging.blocked.folder")
  })

  it("names the Playlist extraction when it is what keeps the sidecar unready", async () => {
    const { component } = await mountWith({ ready: signal(false), extracting: signal(true) })

    expect(component["blockedReason"]()).toBe("tagging.blocked.extracting")
  })

  it("falls back to a generic sidecar reason when unready outside an extraction", async () => {
    const { component } = await mountWith({ ready: signal(false) })

    expect(component["blockedReason"]()).toBe("tagging.blocked.sidecar")
  })
})
