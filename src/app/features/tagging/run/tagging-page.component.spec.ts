import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { By } from "@angular/platform-browser"
import { Router } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { load } from "@tauri-apps/plugin-store"
import { ConfirmationService } from "primeng/api"

import { hostOf } from "../../../../fixtures/dom"
import {
  type SidecarStubOverrides,
  commandFailed,
  sidecarStub,
} from "../../../../fixtures/sidecar-stub"
import { storeStub } from "../../../../fixtures/tauri-store"
import { translateWith } from "../../../../fixtures/translate"
import { readLastDestination } from "../../../core/platform/preferences"
import type { RunFinishedEvent } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"
import {
  PENDING_TRACK,
  arbitrationRequired,
  resolvedTrack,
  writtenTrack as written,
} from "../../../../fixtures/tagging"
import { WRITE_FINISHED, failedRollback } from "../../../../fixtures/write"
import { TOOLTIP } from "../../../shared/utils/tooltip"

import { RecoveryUiStore } from "../url-recovery/recovery-ui.store"
import { RunListComponent } from "./run-list.component"
import TaggingPageComponent from "./tagging-page.component"

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
}))

/**
 * `readLastDestination` passe par `load()` de ce paquet npm : le builder unit-test interdit de
 * mocker un import relatif de l'app.
 */
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

/**
 * Rappeler `readLastDestination()` attend le `prefill()` que le constructeur lance sans
 * l'attendre : sans cette barriere le dossier est encore vide, et `blockedReason` nomme le
 * dossier au lieu du moteur (mesure le 2026-10-13, deux tests en echec sur trois runs).
 */
const mountWith = async (overrides: SidecarStubOverrides = {}) => {
  const service = sidecarStub(overrides)
  vi.mocked(load).mockResolvedValue(storeStub("D:/Sets/Aout"))

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
  afterEach(() => {
    vi.useRealTimers()
  })

  const cancelButton = (fixture: { nativeElement: unknown }): HTMLElement | null =>
    hostOf(fixture).querySelector('[data-p-icon="stop"]')

  const failed = (trackId: string): TaggingTrack => ({
    ...resolvedTrack(trackId),
    state: "write_error",
  })

  it("shows the recovery progress bar after an interrupted run", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingInterrupted: signal(true),
      urlRecoveryProgress: signal({ processed: 0, total: 1 }),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).not.toBeNull()
    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows nothing about recovery while the phase is closed", async () => {
    const { fixture } = await mountWith({ taggingRunId: signal("a3f9c1") })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows the empty recovery state in place of the bar on zero out of zero", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryProgress: signal({ processed: 0, total: 0 }),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).not.toBeNull()
    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
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

      const bars = hostOf(fixture).querySelectorAll("app-phase-progress")
      expect(bars).toHaveLength(1)
      expect(bars[0]?.textContent).toContain(label)
    },
  )

  it.each([
    [
      "a url recovery waits",
      { taggingRunId: signal("a3f9c1"), urlRecoveryBusy: signal(new Set(["a.mp3"])) },
      "tagging.blocked.recovering",
    ],
    [
      "a rollback runs",
      { rollingBack: signal({ runId: "a3f9c1", trackId: null }) },
      "tagging.blocked.restoring",
    ],
    [
      "a run is in progress, ahead of every other cause",
      { tagging: signal(true), apiKeyConfigured: signal(false) },
      "tagging.blocked.running",
    ],
    [
      "the api key is missing, ahead of the folder",
      { apiKeyConfigured: signal(false) },
      "tagging.blocked.api_key",
    ],
    [
      "the Playlist extraction keeps the sidecar unready",
      { ready: signal(false), extracting: signal(true) },
      "tagging.blocked.extracting",
    ],
    [
      "the sidecar is unready outside an extraction",
      { ready: signal(false) },
      "tagging.blocked.sidecar",
    ],
  ] as const)("names the launch blocker when %s", async (_case, overrides, reason) => {
    const { component } = await mountWith(overrides)

    expect(component["blockedReason"]()).toBe(reason)
  })

  it("names the missing folder once the api key is configured", async () => {
    const { component } = await mountWith()
    component["folder"].set("")

    expect(component["blockedReason"]()).toBe("tagging.blocked.folder")
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

  it("cycles its single action with the phase", async () => {
    const tagging = signal(false)
    const confirmable = signal(false)
    const writing = signal(false)
    const retryable = signal(false)
    const taggingTracks = signal<TaggingTrack[]>([])
    const { component } = await mountWith({
      tagging,
      requestedFolder: signal("D:/Sets/Aout"),
      runConfirmable: confirmable,
      writing,
      runRetryable: retryable,
      taggingTracks,
    })
    const seen = [component["action"]()]

    tagging.set(true)
    seen.push(component["action"]())
    tagging.set(false)
    confirmable.set(true)
    seen.push(component["action"]())
    confirmable.set(false)
    writing.set(true)
    seen.push(component["action"]())
    writing.set(false)
    retryable.set(true)
    taggingTracks.set([failed("a.mp3")])
    seen.push(component["action"]())
    writing.set(true)
    seen.push(component["action"]())
    writing.set(false)
    taggingTracks.set([written("a.mp3")])
    seen.push(component["action"]())

    expect(seen).toEqual(["start", "cancel", "commit", "commit", "retry", "retry", "start"])
  })

  it("starts the same folder again when its written run was lost with the engine", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      requestedFolder: signal("D:/Sets/Aout"),
      committed: signal(true),
      runRetryable: signal(false),
      taggingTracks: signal([failed("a.mp3")]),
    })

    expect(component["action"]()).toBe("start")
  })

  it("starts the same folder again when its run cannot be confirmed", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      requestedFolder: signal("D:/Sets/Aout"),
      taggingInterrupted: signal(true),
    })

    expect(component["action"]()).toBe("start")
    expect(component["blockedReason"]()).toBeNull()
  })

  it("starts over when another folder is chosen", async () => {
    vi.mocked(open).mockResolvedValueOnce("D:/Other")
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      requestedFolder: signal("D:/Sets/Aout"),
      runConfirmable: signal(true),
    })
    const before = component["action"]()

    await component["choose"]()

    expect(before).toBe("commit")
    expect(component["action"]()).toBe("start")
  })

  it("keeps the folder of the shown run when the page is recreated", async () => {
    const { component, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      requestedFolder: signal("D:/Sets/Run"),
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
  ] as const)("blocks the confirmation %s", async (_name, overrides, reason) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolvedTrack("a.mp3")]),
      ...overrides,
    })

    expect(component["writeBlockedReason"]()).toBe(reason)
  })

  it("tells the counts in the confirmation and commits only on accept", async () => {
    const unresolvedRow: TaggingTrack = {
      ...PENDING_TRACK,
      trackId: "b.mp3",
      state: "unresolved",
      resolution: "none",
    }
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingWritableCount: signal(1),
      taggingTracks: signal([
        resolvedTrack("a.mp3"),
        unresolvedRow,
        { ...PENDING_TRACK, trackId: "c.mp3", arbitration: arbitrationRequired("c.mp3") },
      ]),
      // Le compte des non resolus vient de la phase de rattrapage, pas des lignes.
      recoverableTracks: signal([unresolvedRow]),
    })
    translateWith({
      tagging: {
        commit: {
          message: "{{folder}} files {{count}}",
          unresolved: "unresolved {{count}}",
          awaiting: "awaiting {{count}}",
          backup: "backed up",
        },
      },
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.commitRun.mock.calls.length
    options?.accept?.()

    expect(options?.message).toBe("D:/Sets/Aout files 1\nunresolved 1\nawaiting 1\n\nbacked up")
    expect(options?.acceptButtonProps).not.toHaveProperty("severity")
    expect(before).toBe(0)
    expect(service.commitRun).toHaveBeenCalledTimes(1)
  })

  it("leaves out the counts that are zero", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolvedTrack("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()

    expect(confirm.mock.calls[0]?.[0].message).toBe(
      "tagging.commit.message\n\ntagging.commit.backup",
    )
  })

  it("keeps the failure message while failures remain, with a confirmed retry", async () => {
    const taggingTracks = signal([written("a.mp3", "write_error"), written("b.mp3", "write_error")])
    const { component, service, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks,
    })
    translateWith({ tagging: { write: { failed: "failed {{count}}" } } })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")
    const shown = (): string | undefined =>
      hostOf(fixture).querySelector("[data-write-failures]")?.textContent
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
    expect(retryOptions?.acceptButtonProps).not.toHaveProperty("severity")
    expect(service.retryWrite).toHaveBeenCalledTimes(1)
    expect(remaining).toContain("failed 1")
    expect(shown()).toBeUndefined()
  })

  it("freezes the rows of a run lost with its engine as of a committed one", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      runFrozen: signal(true),
      taggingTracks: signal([resolvedTrack("a.mp3")]),
    })

    fixture.detectChanges()

    const list = fixture.debugElement.query(By.directive(RunListComponent))
    expect((list.componentInstance as RunListComponent).frozen()).toBe(true)
  })

  it("hides the failure message while the retry writes", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writing: signal(true),
      runRetryable: signal(true),
      taggingTracks: signal([failed("a.mp3")]),
    })

    fixture.detectChanges()

    const action = hostOf(fixture).querySelector('[data-action="retry"]')
    expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
    expect(action?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
  })

  it("disables the retry while a rollback runs", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      requestedFolder: signal("D:/Sets/Aout"),
      runRetryable: signal(true),
      taggingTracks: signal([failed("a.mp3")]),
      rollingBack: signal({ runId: "a3f9c1", trackId: null }),
    })
    fixture.detectChanges()

    const retry = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="retry"]')

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
    const during = hostOf(fixture).querySelector("app-phase-progress")

    writing.set(false)
    fixture.detectChanges()

    expect(during).not.toBeNull()
    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
  })

  it("offers to restore the tracks the sidecar flags as restorable", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([
        written("a.mp3"),
        written("b.mp3", "write_error"),
        resolvedTrack("c.mp3"),
      ]),
    })

    expect([...component["runRestore"].restorableIds()]).toEqual(["a.mp3", "b.mp3"])
    expect(component["runRestore"].canRestoreRun()).toBe(true)
  })

  it("leaves a failed track whose origin was never saved out of the restore", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "write_error", false), written("b.mp3")]),
    })

    expect([...component["runRestore"].restorableIds()]).toEqual(["b.mp3"])
  })

  it.each([
    {
      case: "a track is left to restore",
      tracks: [written("a.mp3", "rolled_back"), written("b.mp3", "write_error")],
      offered: true,
    },
    {
      case: "no track is flagged restorable",
      tracks: [written("a.mp3", "write_error", false)],
      offered: false,
    },
    { case: "every track is restored", tracks: [written("a.mp3", "rolled_back")], offered: false },
  ])("tells whether the run restore is offered when $case", async ({ tracks, offered }) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal(tracks),
    })

    expect(component["runRestore"].canRestoreRun()).toBe(offered)
  })

  it("shows the run restore button even when the write bar is hidden", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="restore-run"]')).not.toBeNull()
  })

  it("disables the run restore while files are busy", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal({ runId: "a3f9c1", trackId: "a.mp3" }),
    })
    fixture.detectChanges()

    const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="restore-run"]')

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

    const restoring = component["runRestore"].restoringRun()

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

      vi.useFakeTimers()
      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="restore-run"]')
      button?.dispatchEvent(new MouseEvent("mouseenter"))
      vi.advanceTimersByTime(TOOLTIP.showDelay ?? 0)

      expect(button?.disabled).toBe(disabled)
      expect(document.body.querySelector(".p-tooltip")?.textContent).toBe(reason)
    },
  )

  it("restores the shown run after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["runRestore"].restoreRun()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.rollback.mock.calls.length
    options?.accept?.()

    expect(options?.acceptButtonProps).toMatchObject({ severity: "danger" })
    expect(before).toBe(0)
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("offers the run summary once the write phase is over", async () => {
    const writeFinished = signal<RunFinishedEvent | null>(null)
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished,
    })
    fixture.detectChanges()
    const before = hostOf(fixture).querySelector('[data-action="recap"]')

    writeFinished.set(WRITE_FINISHED)
    fixture.detectChanges()

    expect(before).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="recap"]')).not.toBeNull()
  })

  it("keeps the run summary within reach when the write bar and the restore are hidden", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished: signal(WRITE_FINISHED),
      taggingTracks: signal([written("a.mp3", "rolled_back")]),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="restore-run"]')).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="recap"]')).not.toBeNull()
  })

  it("opens the run summary", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished: signal(WRITE_FINISHED),
    })
    const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
    fixture.detectChanges()

    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="recap"]')?.click()

    expect(navigate).toHaveBeenCalledWith("/tagging/recap")
  })

  it("restores one track after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["runRestore"].restoreTrack("a.mp3")
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

    component["runRestore"].restoreRun()
    component["runRestore"].restoreTrack("a.mp3")

    expect(confirm).not.toHaveBeenCalled()
  })

  it.each([
    ["the shown run", "a3f9c1", 1],
    ["another run", "b7e2d4", 0],
  ])("lists the rollback failures of %s only", async (_name, shownRunId, expected) => {
    const { component } = await mountWith({
      taggingRunId: signal(shownRunId),
      rollbackFinished: signal(failedRollback()),
    })

    const failures = component["runRestore"].runRollbackFailures()

    expect(failures).toHaveLength(expected)
  })

  it.each([
    ["rollback", "rollback_unavailable"],
    ["commit_run", "tag_dump_write_failed"],
    ["resume_run", "tagging_folder_unreadable"],
    ["discard_run", "run_not_found"],
  ] as const)("shows the error raised by %s", async (command, code) => {
    const { component } = await mountWith(commandFailed(command, code))

    const shown = component["error"]()

    expect(shown?.code).toBe(code)
  })

  it("follows the folder of a run resumed while the page is shown", async () => {
    const requestedFolder = signal<string | null>(null)
    const { component } = await mountWith({
      requestedFolder,
      taggingRunId: signal("a3f9c1"),
      runConfirmable: signal(true),
    })
    const before = component["action"]()

    requestedFolder.set("D:/Sets/Resumed")

    expect(before).toBe("start")
    expect(component["folder"]()).toBe("D:/Sets/Resumed")
    expect(component["action"]()).toBe("commit")
  })

  it("prefills the folder with the destination of the last extraction", async () => {
    const { component, fixture } = await mountWith()

    await fixture.whenStable()

    expect(component["folder"]()).toBe("D:/Sets/Aout")
  })

  it.each([
    ["without an api key", { apiKeyConfigured: signal(false) }],
    ["during a run", { tagging: signal(true) }],
  ])("disables the launch %s", async (_name, overrides) => {
    const { component } = await mountWith(overrides)
    component["folder"].set("D:/Sets/Aout")

    const reason = component["blockedReason"]()

    expect(reason).not.toBeNull()
  })

  it("disables the launch without a folder", async () => {
    const { component } = await mountWith()
    component["folder"].set("")

    const reason = component["blockedReason"]()

    expect(reason).not.toBeNull()
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

  it.each([
    ["shows an error raised by its own command", "start_tagging", "api_key_rejected"],
    ["ignores an error raised by another screen", "set_api_key", null],
  ] as const)("%s", async (_name, command, expected) => {
    const { component } = await mountWith(commandFailed(command, "api_key_rejected"))

    const shown = component["error"]()

    expect(shown?.code ?? null).toBe(expected)
  })
})
