import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { load, type Store } from "@tauri-apps/plugin-store"

import type { SidecarErrorEvent } from "../../core/models/protocol"
import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { PENDING_TRACK } from "../../../fixtures/tagging"

import { RecoveryUiStore } from "./recovery-ui.store"
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
    taggingRunId: signal<string | null>(null),
    taggingInterrupted: signal(false),
    lastError: signal(null),
    lastErrorCommand: signal(null),
    errorFor: SidecarService.prototype.errorFor,
    startTagging: vi.fn(() => Promise.resolve()),
    cancelTagging: vi.fn(() => Promise.resolve()),
    arbitrations: signal([]),
    urlRecoveryProgress: signal<{ processed: number; total: number } | null>(null),
    recoverableTracks: signal([]),
    urlRecoveryBusy: signal(new Set<string>()),
    urlRecoveryErrors: signal(new Map()),
    resolveByUrl: vi.fn(() => Promise.resolve()),
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
  const cancelButton = (fixture: { nativeElement: unknown }): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-p-icon="stop"]')

  const host = (fixture: { nativeElement: unknown }): HTMLElement =>
    fixture.nativeElement as HTMLElement

  it("shows the recovery progress bar after an interrupted run", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingInterrupted: signal(true),
      urlRecoveryProgress: signal({ processed: 0, total: 1 }),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-phase-progress")).not.toBeNull()
    expect(host(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows nothing about recovery while the phase is closed", async () => {
    const { fixture } = await mountWith({ taggingRunId: signal("a3f9c1") })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(host(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows the empty recovery state in place of the bar on zero out of zero", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryProgress: signal({ processed: 0, total: 0 }),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("[data-recovery-empty]")).not.toBeNull()
    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
  })

  it("opens the link dialog on the track of a clicked run row", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      recoverableTracks: signal([{ ...PENDING_TRACK, state: "unresolved" }]),
    })

    component["openRecovery"]("a.mp3")

    expect(TestBed.inject(RecoveryUiStore).target()).toBe("a.mp3")
  })

  it.each<[string, boolean, string]>([
    ["finished", false, "tagging.recovery.phase"],
    ["running", true, "tagging.phase"],
  ])(
    "shows the url recovery progress in place of the run progress (%s)",
    async (_run, running, label) => {
      const { fixture } = await mountWith({
        tagging: signal(running),
        taggingRunId: signal("a3f9c1"),
        urlRecoveryProgress: signal({ processed: 1, total: 2 }),
      })

      fixture.detectChanges()

      const bars = host(fixture).querySelectorAll("app-phase-progress")
      expect(bars).toHaveLength(1)
      expect(bars[0]?.textContent).toContain(label)
    },
  )

  it("blocks a new run while a url recovery waits", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryBusy: signal(new Set(["a.mp3"])),
    })

    expect(component["blockedReason"]()).toBe("tagging.blocked.recovering")
  })

  it("offers no way to interrupt before a run starts", async () => {
    const { fixture } = await mountWith()
    fixture.detectChanges()

    expect(cancelButton(fixture)).toBeNull()
  })

  it("interrupts the run in progress", async () => {
    const { fixture, service } = await mountWith({ tagging: signal(true) })
    fixture.detectChanges()

    cancelButton(fixture)?.closest("button")?.click()

    expect(service.cancelTagging).toHaveBeenCalled()
  })

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

  it.each([
    ["while the sidecar lists the folder", true, null, true],
    ["once an interrupted run has listed its tracks", false, "a3f9c1", true],
    ["before any run", false, null, false],
  ])("decides whether to show the run list %s", async (_name, running, runId, expected) => {
    const { component } = await mountWith({ tagging: signal(running), taggingRunId: signal(runId) })

    const shown = component["showsRun"]()

    expect(shown).toBe(expected)
  })

  it.each([
    ["without a folder", "", "tagging.empty.description"],
    ["with a folder already chosen", "D:/Sets/Aout", "tagging.empty.ready"],
  ])("adapts the idle hint %s", async (_name, folder, expected) => {
    const { component } = await mountWith()
    component["folder"].set(folder)

    const hint = component["idleDescription"]()

    expect(hint).toBe(expected)
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
