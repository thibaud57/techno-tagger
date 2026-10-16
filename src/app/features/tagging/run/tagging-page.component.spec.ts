import { signal } from "@angular/core"
import { type ComponentFixture, TestBed } from "@angular/core/testing"
import { By } from "@angular/platform-browser"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"
import { Tooltip } from "primeng/tooltip"
import { vi } from "vitest"

import { spyConfirmation } from "../../../../fixtures/confirm"
import { action, hostOf } from "../../../../fixtures/dom"
import { type NativeStub, nativeStub } from "../../../../fixtures/native-stub"
import { OTHER_PAST_RUN } from "../../../../fixtures/past-runs"
import { preferencesStub } from "../../../../fixtures/preferences-stub"
import { stubNavigation } from "../../../../fixtures/router"
import { CUSTOM_THRESHOLDS } from "../../../../fixtures/settings"
import {
  type SidecarStubOverrides,
  activeRun,
  commandFailed,
  provideSidecarStub,
  sidecarStub,
} from "../../../../fixtures/sidecar-stub"
import {
  RUN_ID,
  awaitingTrack,
  resolvedTrack,
  unresolvedTrack,
  writtenTrack as written,
} from "../../../../fixtures/tagging"
import { translateWith } from "../../../../fixtures/translate"
import { WRITE_FINISHED, failedRollback } from "../../../../fixtures/write"
import { NativeService } from "../../../core/platform/native.service"
import { PreferencesService } from "../../../core/platform/preferences.service"
import type { RunFinishedEvent } from "../../../core/sidecar/protocol"

import { RecoveryUiStore } from "../url-recovery/recovery-ui.store"
import { RunListComponent } from "./run-list.component"
import TaggingPageComponent from "./tagging-page.component"

/** Dernier dossier d'extraction, que la page propose tant qu'aucun run ne lui impose le sien. */
const FOLDER = "D:/Sets/Aout"

/**
 * Le constructeur lance `prefill()` sans l'attendre : sans attendre le dossier, `blockedReason`
 * nomme le dossier au lieu du moteur (mesure le 2026-10-13, deux tests en echec sur trois runs).
 * Le champ se remplit toujours, du run affiche ou de la derniere destination.
 */
const mountWith = async (
  overrides: SidecarStubOverrides = {},
  native: NativeStub = nativeStub(FOLDER),
) => {
  const service = sidecarStub(overrides)
  const preferences = preferencesStub({ lastDestination: FOLDER })

  TestBed.configureTestingModule({
    imports: [TaggingPageComponent],
    providers: [
      provideTranslateService(),
      ConfirmationService,
      provideSidecarStub(service),
      { provide: NativeService, useValue: native },
      { provide: PreferencesService, useValue: preferences },
    ],
  })

  const fixture = TestBed.createComponent(TaggingPageComponent)
  await vi.waitFor(
    () => {
      expect(fixture.componentInstance["folder"]()).not.toBe("")
    },
    { interval: 1 },
  )

  return { fixture, component: fixture.componentInstance, service, preferences }
}

/** Fraiche a chaque appel : les signals ne sont jamais partages entre deux tests. */
const committedRun = (): SidecarStubOverrides => ({
  ...activeRun(RUN_ID),
  committed: signal(true),
})

const tooltipOf = (fixture: ComponentFixture<unknown>, name: string) =>
  fixture.debugElement
    .query(By.css(`[data-action="${name}"]`))
    .injector.get(Tooltip)
    .content()

describe("TaggingPageComponent", () => {
  it("shows the recovery progress bar after an interrupted run", async () => {
    const { fixture } = await mountWith({
      ...activeRun(RUN_ID),
      taggingInterrupted: signal(true),
      urlRecoveryProgress: signal({ processed: 0, total: 1 }),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).not.toBeNull()
    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows nothing about recovery while the phase is closed", async () => {
    const { fixture } = await mountWith(activeRun(RUN_ID))

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).toBeNull()
  })

  it("shows the empty recovery state in place of the bar on zero out of zero", async () => {
    const { fixture } = await mountWith({
      ...activeRun(RUN_ID),
      urlRecoveryProgress: signal({ processed: 0, total: 0 }),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("[data-recovery-empty]")).not.toBeNull()
    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
  })

  it("opens the link dialog on the track of a clicked run row", async () => {
    const { component } = await mountWith({
      ...activeRun(RUN_ID),
      recoverableTracks: signal([unresolvedTrack("a.mp3", "no_result")]),
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
        ...activeRun(RUN_ID),
        tagging: signal(running),
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
      { ...activeRun(RUN_ID), urlRecoveryBusy: signal(new Set(["a.mp3"])) },
      "tagging.blocked.recovering",
    ],
    [
      "a rollback runs",
      { rollingBack: signal({ runId: RUN_ID, trackId: null }) },
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

  // La phase qui propose chaque action vit dans `SidecarService.runAction` : ici, seul compte
  // le bouton que la page en tire.
  it.each([
    { action: "start", label: "tagging.start", overrides: {} },
    { action: "cancel", label: "tagging.cancel", overrides: { tagging: signal(true) } },
    {
      action: "commit",
      label: "tagging.commit.action",
      overrides: {
        ...activeRun(RUN_ID),
        requestedFolder: signal(FOLDER),
        runConfirmable: signal(true),
      },
    },
    {
      action: "retry",
      label: "tagging.retry.action",
      overrides: {
        ...committedRun(),
        requestedFolder: signal(FOLDER),
        runRetryable: signal(true),
        taggingTracks: signal([written("a.mp3", "write_error")]),
      },
    },
  ])(
    "shows the $action button when the run proposes it",
    async ({ action: name, label, overrides }) => {
      const { fixture } = await mountWith(overrides)

      fixture.detectChanges()

      expect(action(name, hostOf(fixture))?.textContent).toContain(label)
    },
  )

  it("offers no way to interrupt before a run starts", async () => {
    const { fixture } = await mountWith()

    fixture.detectChanges()

    expect(action("cancel", hostOf(fixture))).toBeNull()
  })

  it("interrupts the run in progress", async () => {
    const { fixture, service } = await mountWith({ tagging: signal(true) })
    fixture.detectChanges()

    action("cancel", hostOf(fixture))?.click()

    expect(service.cancelTagging).toHaveBeenCalled()
  })

  it("leaves the launch available for a run that cannot be confirmed", async () => {
    const { component } = await mountWith({
      ...activeRun(RUN_ID),
      requestedFolder: signal(FOLDER),
      taggingInterrupted: signal(true),
    })

    expect(component["blockedReason"]()).toBeNull()
  })

  it("starts over when another folder is chosen", async () => {
    const { component } = await mountWith(
      {
        ...activeRun(RUN_ID),
        requestedFolder: signal(FOLDER),
        runConfirmable: signal(true),
      },
      nativeStub("D:/Other"),
    )

    await component["choose"]()

    expect(component["action"]()).toBe("start")
  })

  it("keeps the folder of the shown run when the page is recreated", async () => {
    const { component } = await mountWith({
      ...activeRun(RUN_ID),
      requestedFolder: signal("D:/Sets/Run"),
    })

    expect(component["folder"]()).toBe("D:/Sets/Run")
  })

  it.each([
    [
      "while a rollback runs",
      { rollingBack: signal({ runId: RUN_ID, trackId: null }) },
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
      ...activeRun(RUN_ID),
      taggingTracks: signal([resolvedTrack("a.mp3")]),
      ...overrides,
    })

    expect(component["writeBlockedReason"]()).toBe(reason)
  })

  describe("commit confirmation", () => {
    const mountCommit = async () => {
      const unresolvedRow = unresolvedTrack("b.mp3")
      const mounted = await mountWith({
        ...activeRun(RUN_ID),
        taggingFolder: signal(FOLDER),
        taggingWritableCount: signal(1),
        taggingTracks: signal([resolvedTrack("a.mp3"), unresolvedRow, awaitingTrack("c.mp3")]),
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

      return { ...mounted, confirmation: spyConfirmation() }
    }

    it("tells the counts of the run", async () => {
      const { component, confirmation } = await mountCommit()

      component["commit"]()

      expect(confirmation.options()?.message).toBe(
        "D:/Sets/Aout files 1\nunresolved 1\nawaiting 1\n\nbacked up",
      )
    })

    it("asks a confirmation that is not destructive", async () => {
      const { component, confirmation } = await mountCommit()

      component["commit"]()

      expect(confirmation.options()?.acceptButtonProps).not.toHaveProperty("severity")
    })

    it("commits nothing before the accept", async () => {
      const { component, service } = await mountCommit()

      component["commit"]()

      expect(service.commitRun).not.toHaveBeenCalled()
    })

    it("commits once on accept", async () => {
      const { component, service, confirmation } = await mountCommit()
      component["commit"]()

      confirmation.accept()

      expect(service.commitRun).toHaveBeenCalledTimes(1)
    })

    it("leaves out the counts that are zero", async () => {
      const { component } = await mountWith({
        ...activeRun(RUN_ID),
        taggingTracks: signal([resolvedTrack("a.mp3")]),
      })
      const confirmation = spyConfirmation()

      component["commit"]()

      expect(confirmation.options()?.message).toBe(
        "tagging.commit.message\n\ntagging.commit.backup",
      )
    })
  })

  describe("write failures", () => {
    const failureMessage = (fixture: ComponentFixture<unknown>): string | undefined =>
      hostOf(fixture).querySelector("[data-write-failures]")?.textContent

    const mountFailures = async () => {
      const taggingTracks = signal([
        written("a.mp3", "write_error"),
        written("b.mp3", "write_error"),
      ])
      const mounted = await mountWith({ ...committedRun(), taggingTracks })
      translateWith({ tagging: { write: { failed: "failed {{count}}" } } })

      return { ...mounted, taggingTracks, confirmation: spyConfirmation() }
    }

    it("counts the failures in the message", async () => {
      const { fixture } = await mountFailures()

      fixture.detectChanges()

      expect(failureMessage(fixture)).toContain("failed 2")
    })

    it("keeps the message with the remaining count while failures remain", async () => {
      const { fixture, taggingTracks } = await mountFailures()
      fixture.detectChanges()

      taggingTracks.set([written("b.mp3", "write_error")])
      fixture.detectChanges()

      expect(failureMessage(fixture)).toContain("failed 1")
    })

    it("drops the message once nothing fails", async () => {
      const { fixture, taggingTracks } = await mountFailures()
      fixture.detectChanges()

      taggingTracks.set([written("b.mp3")])
      fixture.detectChanges()

      expect(failureMessage(fixture)).toBeUndefined()
    })

    it("asks a confirmation that is not destructive to retry", async () => {
      const { component, confirmation } = await mountFailures()

      component["retry"]()

      expect(confirmation.options()?.acceptButtonProps).not.toHaveProperty("severity")
    })

    it("retries the write once confirmed", async () => {
      const { component, service, confirmation } = await mountFailures()
      component["retry"]()

      confirmation.accept()

      expect(service.retryWrite).toHaveBeenCalledTimes(1)
    })

    it("hides the message while the retry writes", async () => {
      const { fixture } = await mountWith({
        ...committedRun(),
        writing: signal(true),
        runRetryable: signal(true),
        taggingTracks: signal([written("a.mp3", "write_error")]),
      })

      fixture.detectChanges()

      expect(failureMessage(fixture)).toBeUndefined()
      expect(
        action("retry", hostOf(fixture))?.querySelector('[data-icon="spinner"]'),
      ).not.toBeNull()
    })

    it("disables the retry while a rollback runs", async () => {
      const { fixture } = await mountWith({
        ...committedRun(),
        requestedFolder: signal(FOLDER),
        runRetryable: signal(true),
        taggingTracks: signal([written("a.mp3", "write_error")]),
        rollingBack: signal({ runId: RUN_ID, trackId: null }),
      })

      fixture.detectChanges()

      expect(action("retry", hostOf(fixture))?.disabled).toBe(true)
    })
  })

  it("freezes the rows of a run lost with its engine as of a committed one", async () => {
    const { fixture } = await mountWith({
      ...activeRun(RUN_ID),
      runFrozen: signal(true),
      taggingTracks: signal([resolvedTrack("a.mp3")]),
    })

    fixture.detectChanges()

    const list = fixture.debugElement.query(By.directive(RunListComponent))
    expect((list.componentInstance as RunListComponent).frozen()).toBe(true)
  })

  describe("write bar", () => {
    const mountRetryWriting = async () => {
      const writing = signal(true)
      const mounted = await mountWith({
        ...committedRun(),
        writing,
        taggingTracks: signal([written("a.mp3", "write_error")]),
      })

      return { ...mounted, writing }
    }

    it("shows the bar while the retry writes", async () => {
      const { fixture } = await mountRetryWriting()

      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("app-phase-progress")).not.toBeNull()
    })

    it("drops the bar when a refused retry left no step", async () => {
      const { fixture, writing } = await mountRetryWriting()
      fixture.detectChanges()
      writing.set(false)

      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    })
  })

  it("offers to restore the tracks the sidecar flags as restorable", async () => {
    const { component } = await mountWith({
      ...committedRun(),
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
      ...committedRun(),
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
      ...committedRun(),
      taggingTracks: signal(tracks),
    })

    expect(component["runRestore"].canRestoreRun()).toBe(offered)
  })

  it("shows the run restore button even when the write bar is hidden", async () => {
    const { fixture } = await mountWith({
      ...committedRun(),
      taggingTracks: signal([written("a.mp3")]),
    })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(action("restore-run", hostOf(fixture))).not.toBeNull()
  })

  it("disables the run restore while files are busy", async () => {
    const { fixture } = await mountWith({
      ...committedRun(),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal({ runId: RUN_ID, trackId: "a.mp3" }),
    })

    fixture.detectChanges()

    expect(action("restore-run", hostOf(fixture))?.disabled).toBe(true)
  })

  it.each([
    ["a run restore of the shown run", { runId: RUN_ID, trackId: null }, true],
    ["a run restore of another run", { runId: OTHER_PAST_RUN.run_id, trackId: null }, false],
    ["a track restore of the shown run", { runId: RUN_ID, trackId: "a.mp3" }, false],
  ])("flags the run restore as running only for %s", async (_name, rollingBack, expected) => {
    const { component } = await mountWith({
      ...committedRun(),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal(rollingBack),
    })

    expect(component["runRestore"].restoringRun()).toBe(expected)
  })

  // Le motif voyage dans le `pTooltip` du bouton : le survol, lui, est du ressort de PrimeNG.
  it.each([
    {
      case: "a restore runs",
      rollingBack: { runId: RUN_ID, trackId: "a.mp3" },
      reason: "tagging.rollback.blocked",
    },
    { case: "files are idle", rollingBack: null, reason: undefined },
  ])("gives the run restore its reason only when $case", async ({ rollingBack, reason }) => {
    const { fixture } = await mountWith({
      ...committedRun(),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal(rollingBack),
    })

    fixture.detectChanges()

    expect(tooltipOf(fixture, "restore-run")).toBe(reason)
  })

  describe("run restore confirmation", () => {
    const mountRestore = async () => {
      const mounted = await mountWith({
        ...committedRun(),
        taggingTracks: signal([written("a.mp3"), written("b.mp3")]),
      })

      return { ...mounted, confirmation: spyConfirmation() }
    }

    it("asks a danger confirmation to restore the shown run", async () => {
      const { component, confirmation } = await mountRestore()

      component["runRestore"].restoreRun()

      expect(confirmation.options()?.acceptButtonProps).toMatchObject({ severity: "danger" })
    })

    it("restores nothing before the accept", async () => {
      const { component, service } = await mountRestore()

      component["runRestore"].restoreRun()

      expect(service.rollback).not.toHaveBeenCalled()
    })

    it("restores the shown run once confirmed", async () => {
      const { component, service, confirmation } = await mountRestore()
      component["runRestore"].restoreRun()

      confirmation.accept()

      expect(service.rollback).toHaveBeenCalledWith(RUN_ID)
    })

    it("restores one track once confirmed", async () => {
      const { component, service, confirmation } = await mountRestore()
      component["runRestore"].restoreTrack("a.mp3")

      confirmation.accept()

      expect(service.rollback).toHaveBeenCalledWith(RUN_ID, "a.mp3")
    })

    it("asks nothing while files are busy", async () => {
      const { component } = await mountWith({
        ...committedRun(),
        taggingTracks: signal([written("a.mp3")]),
        writing: signal(true),
      })
      const confirmation = spyConfirmation()

      component["runRestore"].restoreRun()
      component["runRestore"].restoreTrack("a.mp3")

      expect(confirmation.options()).toBeUndefined()
    })
  })

  describe("run summary", () => {
    it("offers no summary before the write phase is over", async () => {
      const { fixture } = await mountWith({
        ...committedRun(),
        writeFinished: signal<RunFinishedEvent | null>(null),
      })

      fixture.detectChanges()

      expect(action("recap", hostOf(fixture))).toBeNull()
    })

    it("offers the summary once the write phase is over", async () => {
      const writeFinished = signal<RunFinishedEvent | null>(null)
      const { fixture } = await mountWith({ ...committedRun(), writeFinished })
      fixture.detectChanges()
      writeFinished.set(WRITE_FINISHED)

      fixture.detectChanges()

      expect(action("recap", hostOf(fixture))).not.toBeNull()
    })

    it("keeps the summary within reach when the write bar and the restore are hidden", async () => {
      const { fixture } = await mountWith({
        ...committedRun(),
        writeFinished: signal(WRITE_FINISHED),
        taggingTracks: signal([written("a.mp3", "rolled_back")]),
      })

      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("app-phase-progress")).toBeNull()
      expect(action("restore-run", hostOf(fixture))).toBeNull()
      expect(action("recap", hostOf(fixture))).not.toBeNull()
    })

    it("opens the summary", async () => {
      const { fixture } = await mountWith({
        ...committedRun(),
        writeFinished: signal(WRITE_FINISHED),
      })
      const navigate = stubNavigation("navigateByUrl")
      fixture.detectChanges()

      action("recap", hostOf(fixture))?.click()

      expect(navigate).toHaveBeenCalledWith("/tagging/recap")
    })
  })

  it.each([
    ["the shown run", RUN_ID, 1],
    ["another run", OTHER_PAST_RUN.run_id, 0],
  ])("lists the rollback failures of %s only", async (_name, shownRunId, expected) => {
    const { component } = await mountWith({
      taggingRunId: signal(shownRunId),
      rollbackFinished: signal(failedRollback()),
    })

    expect(component["runRestore"].runRollbackFailures()).toHaveLength(expected)
  })

  it.each([
    ["rollback", "rollback_unavailable"],
    ["commit_run", "tag_dump_write_failed"],
    ["resume_run", "tagging_folder_unreadable"],
    ["discard_run", "run_not_found"],
  ] as const)("shows the error raised by %s", async (command, code) => {
    const { component } = await mountWith(commandFailed(command, code))

    expect(component["error"]()?.code).toBe(code)
  })

  it("follows the folder of a run resumed while the page is shown", async () => {
    const requestedFolder = signal<string | null>(null)
    const { component } = await mountWith({
      ...activeRun(RUN_ID),
      requestedFolder,
      runConfirmable: signal(true),
    })

    requestedFolder.set("D:/Sets/Resumed")

    expect(component["folder"]()).toBe("D:/Sets/Resumed")
    expect(component["action"]()).toBe("commit")
  })

  it("prefills the folder with the destination of the last extraction", async () => {
    const { component } = await mountWith()

    expect(component["folder"]()).toBe(FOLDER)
  })

  it("sends the start tagging command with the chosen folder", async () => {
    const { component, service } = await mountWith()
    component["folder"].set(FOLDER)

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith(FOLDER, undefined)
  })

  it("sends the thresholds set in the settings", async () => {
    const { component, service, preferences } = await mountWith()
    component["folder"].set(FOLDER)
    preferences.readThresholds.mockResolvedValue(CUSTOM_THRESHOLDS)

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith(FOLDER, CUSTOM_THRESHOLDS)
  })

  it.each([
    ["while the sidecar lists the folder", true, null, true],
    ["once an interrupted run has listed its tracks", false, RUN_ID, true],
    ["before any run", false, null, false],
  ])("decides whether to show the run list %s", async (_name, running, runId, expected) => {
    const { component } = await mountWith({ tagging: signal(running), taggingRunId: signal(runId) })

    expect(component["showsRun"]()).toBe(expected)
  })

  it.each([
    ["without a folder", "", "tagging.empty.description"],
    ["with a folder already chosen", FOLDER, "tagging.empty.ready"],
  ])("adapts the idle hint %s", async (_name, folder, expected) => {
    const { component } = await mountWith()
    component["folder"].set(folder)

    expect(component["idleDescription"]()).toBe(expected)
  })

  it.each([
    ["shows an error raised by its own command", "start_tagging", "api_key_rejected"],
    ["ignores an error raised by another screen", "set_api_key", null],
  ] as const)("%s", async (_name, command, expected) => {
    const { component } = await mountWith(commandFailed(command, "api_key_rejected"))

    expect(component["error"]()?.code ?? null).toBe(expected)
  })
})
