import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { By } from "@angular/platform-browser"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { load, type Store } from "@tauri-apps/plugin-store"
import { ConfirmationService } from "primeng/api"
import { Tooltip } from "primeng/tooltip"

import type { RollbackFinishedEvent, SidecarErrorEvent } from "../../core/models/protocol"
import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"
import { PENDING_TRACK, arbitrationRequired } from "../../../fixtures/tagging"
import { rollbackFinished } from "../../../fixtures/write"

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
    committed: signal(false),
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
    writing: signal(false),
    writeProgress: signal<{ processed: number; total: number } | null>(null),
    arbitrationInFlight: signal(false),
    rollingBack: signal<{ runId: string; trackId: string | null } | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    taggingFolder: signal<string | null>(null),
    rollback: vi.fn(() => Promise.resolve()),
    commitRun: vi.fn(() => Promise.resolve()),
    retryWrite: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  vi.mocked(load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
  } as unknown as Store)

  TestBed.configureTestingModule({
    imports: [TaggingPageComponent],
    providers: [
      provideTranslateService(),
      ConfirmationService,
      { provide: SidecarService, useValue: service },
    ],
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

  const resolved = (trackId: string): TaggingTrack => ({
    ...PENDING_TRACK,
    trackId,
    state: "resolved",
    resolution: "auto",
  })
  const failed = (trackId: string): TaggingTrack => ({ ...resolved(trackId), state: "write_error" })
  const written = (trackId: string, state: TaggingTrack["state"] = "written"): TaggingTrack => ({
    ...resolved(trackId),
    state,
  })

  it("cycles its single action with the phase", async () => {
    const tagging = signal(false)
    const runId = signal<string | null>(null)
    const committed = signal(false)
    const writing = signal(false)
    const { component } = await mountWith({
      tagging,
      taggingRunId: runId,
      taggingFolder: signal("D:/Sets/Aout"),
      committed,
      writing,
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const seen = [component["action"]()]

    tagging.set(true)
    runId.set("a3f9c1")
    seen.push(component["action"]())
    tagging.set(false)
    seen.push(component["action"]())
    committed.set(true)
    writing.set(true)
    seen.push(component["action"]())
    writing.set(false)
    seen.push(component["action"]())

    expect(seen).toEqual(["start", "cancel", "commit", "commit", "start"])
  })

  it("offers to confirm an interrupted run", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingInterrupted: signal(true),
      taggingTracks: signal([resolved("a.mp3")]),
    })

    expect(component["action"]()).toBe("commit")
  })

  it("starts over when another folder is chosen", async () => {
    vi.mocked(open).mockResolvedValueOnce("D:/Other")
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const before = component["action"]()

    await component["choose"]()

    expect(before).toBe("commit")
    expect(component["action"]()).toBe("start")
  })

  it("keeps the folder of the shown run when the page is recreated", async () => {
    const { component, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Run"),
    })

    await fixture.whenStable()

    expect(component["folder"]()).toBe("D:/Sets/Run")
  })

  it.each([
    [
      "while a rollback runs",
      { rollingBack: signal({ runId: "a3f9c1", trackId: null }) },
      "tagging.blocked.restoring",
    ],
    [
      "while a link is being resolved",
      { urlRecoveryBusy: signal(new Set(["b.mp3"])) },
      "tagging.blocked.recovering",
    ],
    [
      "while an arbitration is in flight",
      { arbitrationInFlight: signal(true) },
      "tagging.blocked.arbitrating",
    ],
    ["without a resolved track", { taggingTracks: signal([]) }, "tagging.blocked.nothingToWrite"],
  ] as const)("blocks the confirmation %s", async (_name, overrides, reason) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolved("a.mp3")]),
      ...overrides,
    })

    expect(component["commitBlockedReason"]()).toBe(reason)
  })

  it("tells the counts in the confirmation and commits only on accept", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingTracks: signal([
        resolved("a.mp3"),
        { ...PENDING_TRACK, trackId: "b.mp3", state: "unresolved", resolution: "none" },
        { ...PENDING_TRACK, trackId: "c.mp3", arbitration: arbitrationRequired("c.mp3") },
      ]),
    })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", {
      tagging: {
        commit: {
          message: "{{folder}} files {{count}}.",
          unresolved: "unresolved {{count}}.",
          awaiting: "awaiting {{count}}.",
        },
      },
    })
    translate.use("en")
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.commitRun.mock.calls.length
    options?.accept?.()

    expect(options?.message).toBe("D:/Sets/Aout files 1. unresolved 1. awaiting 1.")
    expect(options?.acceptButtonProps).toEqual({})
    expect(before).toBe(0)
    expect(service.commitRun).toHaveBeenCalledTimes(1)
  })

  it("leaves out the counts that are zero", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()

    expect(confirm.mock.calls[0]?.[0].message).toBe("tagging.commit.message")
  })

  it("keeps the failure message while failures remain, with a confirmed retry", async () => {
    const taggingTracks = signal([written("a.mp3", "write_error"), written("b.mp3", "write_error")])
    const { component, service, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks,
    })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { tagging: { write: { failed: "failed {{count}}" } } })
    translate.use("en")
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")
    const shown = (): string | undefined =>
      host(fixture).querySelector("[data-write-failures]")?.textContent
    fixture.detectChanges()
    const before = shown()

    component["retry"]()
    const retryOptions = confirm.mock.calls[0]?.[0]
    retryOptions?.accept?.()
    taggingTracks.set([written("b.mp3", "write_error")])
    fixture.detectChanges()
    const remaining = shown()
    taggingTracks.set([written("b.mp3")])
    fixture.detectChanges()

    expect(before).toContain("failed 2")
    expect(retryOptions?.acceptButtonProps).toEqual({})
    expect(service.retryWrite).toHaveBeenCalledTimes(1)
    expect(remaining).toContain("failed 1")
    expect(shown()).toBeUndefined()
  })

  it("hides the failure message while the retry writes", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writing: signal(true),
      taggingTracks: signal([failed("a.mp3")]),
    })

    fixture.detectChanges()

    const action = host(fixture).querySelector('[data-action="commit"]')
    expect(host(fixture).querySelector("[data-write-failures]")).toBeNull()
    expect(action?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
  })

  it("disables the retry while a rollback runs", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([failed("a.mp3")]),
      rollingBack: signal({ runId: "a3f9c1", trackId: null }),
    })
    fixture.detectChanges()

    const retry = host(fixture).querySelector<HTMLButtonElement>('[data-action="retry"]')

    expect(retry?.disabled).toBe(true)
  })

  it("drops the write bar when a refused retry left no step", async () => {
    const writing = signal(true)
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writing,
      taggingTracks: signal([failed("a.mp3")]),
    })
    fixture.detectChanges()
    const during = host(fixture).querySelector("app-phase-progress")

    writing.set(false)
    fixture.detectChanges()

    expect(during).not.toBeNull()
    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
  })

  it("offers to restore written and failed tracks of a committed run", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3", "write_error"), resolved("c.mp3")]),
    })

    expect([...component["restorableIds"]()]).toEqual(["a.mp3", "b.mp3"])
    expect(component["canRestoreRun"]()).toBe(true)
  })

  it("keeps the run button while a track is left to restore", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "rolled_back"), written("b.mp3", "write_error")]),
    })

    expect(component["canRestoreRun"]()).toBe(true)
  })

  it("drops the run button once every track is restored", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "rolled_back")]),
    })

    expect(component["canRestoreRun"]()).toBe(false)
  })

  it("shows the run restore button even when the write bar is hidden", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(host(fixture).querySelector('[data-action="restore-run"]')).not.toBeNull()
  })

  it("disables the run restore while files are busy", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal({ runId: "a3f9c1", trackId: "a.mp3" }),
    })
    fixture.detectChanges()

    const button = host(fixture).querySelector<HTMLButtonElement>('[data-action="restore-run"]')

    expect(button?.disabled).toBe(true)
  })

  it.each([
    ["a run restore of the shown run", { runId: "a3f9c1", trackId: null }, true],
    ["a run restore of another run", { runId: "b7e2d4", trackId: null }, false],
    ["a track restore of the shown run", { runId: "a3f9c1", trackId: "a.mp3" }, false],
  ])("flags the run restore as running only for %s", async (_name, rollingBack, expected) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal(rollingBack),
    })

    const restoring = component["restoringRun"]()

    expect(restoring).toBe(expected)
  })

  it.each([
    [
      "a restore runs",
      signal({ runId: "a3f9c1", trackId: "a.mp3" }),
      true,
      "tagging.rollback.blocked",
    ],
    ["files are idle", signal(null), false, undefined],
  ])(
    "gives the run restore its reason only while busy (%s)",
    async (_name, rollingBack, disabled, reason) => {
      const { fixture } = await mountWith({
        taggingRunId: signal("a3f9c1"),
        committed: signal(true),
        taggingTracks: signal([written("a.mp3")]),
        rollingBack,
      })
      fixture.detectChanges()

      const button = fixture.debugElement.query(By.css('[data-action="restore-run"]'))

      expect((button.nativeElement as HTMLButtonElement).disabled).toBe(disabled)
      expect(button.injector.get(Tooltip).content()).toBe(reason)
    },
  )

  it("restores the shown run after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreRun"]()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.rollback.mock.calls.length
    options?.accept?.()

    expect(options?.acceptButtonProps).toEqual({ severity: "danger" })
    expect(before).toBe(0)
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("restores one track after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreTrack"]("a.mp3")
    confirm.mock.calls[0]?.[0].accept?.()

    expect(service.rollback).toHaveBeenCalledWith("a3f9c1", "a.mp3")
  })

  it("asks nothing while files are busy", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      writing: signal(true),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreRun"]()
    component["restoreTrack"]("a.mp3")

    expect(confirm).not.toHaveBeenCalled()
  })

  it("counts the write failures on the rows", async () => {
    const { component } = await mountWith({
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "write_error"), written("b.mp3", "rolled_back")]),
    })

    expect(component["writeFailures"]()).toBe(1)
  })

  it("lists the rollback failures of the shown run only", async () => {
    const failedRollback = {
      ...rollbackFinished(),
      failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" as const }],
    }
    const shown = await mountWith({
      taggingRunId: signal("a3f9c1"),
      rollbackFinished: signal(failedRollback),
    })
    const ownFailures = shown.component["runRollbackFailures"]()
    TestBed.resetTestingModule()

    const other = await mountWith({
      taggingRunId: signal("b7e2d4"),
      rollbackFinished: signal(failedRollback),
    })

    expect(ownFailures).toHaveLength(1)
    expect(other.component["runRollbackFailures"]()).toEqual([])
  })

  it("blocks a launch while a rollback runs", async () => {
    const { component } = await mountWith({
      rollingBack: signal({ runId: "a3f9c1", trackId: null }),
    })

    expect(component["blockedReason"]()).toBe("tagging.blocked.restoring")
  })

  it("shows an error raised by rollback", async () => {
    const failure: SidecarErrorEvent = {
      event: "error",
      code: "rollback_unavailable",
      params: {},
      message: "",
      command: "rollback",
    }
    const { component } = await mountWith({
      lastError: signal(failure),
      lastErrorCommand: signal("rollback"),
    })

    expect(component["error"]()?.code).toBe("rollback_unavailable")
  })

  it("shows an error raised by commit_run", async () => {
    const failure: SidecarErrorEvent = {
      event: "error",
      code: "tag_dump_write_failed",
      params: {},
      message: "",
      command: "commit_run",
    }
    const { component } = await mountWith({
      lastError: signal(failure),
      lastErrorCommand: signal("commit_run"),
    })

    expect(component["error"]()?.code).toBe("tag_dump_write_failed")
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
