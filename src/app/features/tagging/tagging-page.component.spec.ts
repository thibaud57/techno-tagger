import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { load, type Store } from "@tauri-apps/plugin-store"

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
 * Ce qui se teste ici : la disponibilite du lancement et la commande emise. Le reste de
 * l'ecran affiche ce qu'il recoit ; le signal de fin vit dans `CompletionSignalService`.
 *
 * Rappeler `readLastDestination()` attend le `prefill()` que le constructeur lance sans
 * l'attendre : sans cette barriere, la promesse se resout pendant un AUTRE fichier de
 * spec (`isolate: false`) et y perturbe le mock de `@tauri-apps/plugin-store`.
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
  vi.mocked(load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
  } as unknown as Store)

  TestBed.configureTestingModule({
    imports: [TaggingPageComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })

  const fixture = TestBed.createComponent(TaggingPageComponent)
  await readLastDestination()

  return { fixture, component: fixture.componentInstance, service }
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
