import { computed, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"

import { PAST_RUN, TRACK_LOADED } from "../../../fixtures/past-runs"
import { unresolvedTrack, writtenTrack } from "../../../fixtures/tagging"
import { settleScroller, stubOffscreenLayout } from "../../../fixtures/virtual-scroll"
import { commandError, rollbackFinished } from "../../../fixtures/write"
import type { RollbackFinishedEvent } from "../../core/models/protocol"
import { type LoadedRun, type LoadRefusal, loadedTrack } from "../../core/past-runs.store"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"
import type { RollbackInFlight } from "../../core/write.store"

import RecapPageComponent from "./recap-page.component"

/** Non restaurable : seul le test de la restauration pose le bouton du run. */
const written = (trackId: string, title: string): TaggingTrack => ({
  ...writtenTrack(trackId, "written", false),
  title,
})

/**
 * Ce qui se teste ici : les morceaux affiches, les filtres et les gestes du pied. Le service est
 * un stub ; `filesBusy` suit `writing` et `rollingBack`, `writeFailureCount` les morceaux,
 * surcharges comprises.
 */
const mountWith = async (
  tracks: readonly TaggingTrack[],
  overrides: Partial<Record<string, unknown>> = {},
  runId?: string,
) => {
  const base = {
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? "a3f9c1" : null),
    writing: signal(false),
    rollingBack: signal<RollbackInFlight | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    rollback: vi.fn(() => Promise.resolve()),
    clearRun: vi.fn(),
    available: signal<boolean | null>(true),
    loadedRun: signal<LoadedRun | null>(null),
    loadRun: vi.fn(() => Promise.resolve()),
    loadRefusal: signal<LoadRefusal | null>(null),
    ...overrides,
  }
  const service = {
    ...base,
    filesBusy: computed(() => base.writing() || base.rollingBack() !== null),
    writeFailureCount: computed(
      () => base.taggingTracks().filter((track) => track.state === "write_error").length,
    ),
  }
  TestBed.configureTestingModule({
    imports: [RecapPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      { provide: SidecarService, useValue: service },
    ],
  })
  const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
  const fixture = TestBed.createComponent(RecapPageComponent)
  if (runId !== undefined) {
    fixture.componentRef.setInput("runId", runId)
  }
  fixture.detectChanges()
  await settleScroller(fixture)

  return { fixture, component: fixture.componentInstance, service, navigate }
}

const hostOf = (fixture: { nativeElement: unknown }): HTMLElement =>
  fixture.nativeElement as HTMLElement

/** Une ligne par bouton d'ouverture du detail : le scroll virtuel ne monte que les lignes visibles. */
const rowsIn = (fixture: { nativeElement: unknown }): number =>
  hostOf(fixture).querySelectorAll("[data-row-toggle]").length

const search = async (
  fixture: { nativeElement: unknown; detectChanges: () => void },
  text: string,
) => {
  const field = hostOf(fixture).querySelector<HTMLInputElement>('input[data-field="search"]')
  if (!field) {
    throw new Error("recherche introuvable dans le recapitulatif")
  }
  field.value = text
  field.dispatchEvent(new Event("input"))
  await settleScroller(fixture)
}

describe("RecapPageComponent", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubOffscreenLayout()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("narrows the table to the chosen filter", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit"), unresolvedTrack("b")])
    const before = rowsIn(fixture)

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(before).toBe(2)
    expect(rowsIn(fixture)).toBe(1)
  })

  it("gives each filter option its count", async () => {
    const { fixture } = await mountWith([
      written("a", "Dim Orbit"),
      written("b", "Kelvor"),
      unresolvedTrack("c"),
    ])

    const counts = [...hostOf(fixture).querySelectorAll("[data-filter] .tabular-nums")].map(
      (count) => count.textContent.trim(),
    )

    expect(counts).toEqual(["3", "2", "0", "1"])
  })

  it("shows the empty state when the search matches nothing", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit")])

    await search(fixture, "kelvor")

    expect(rowsIn(fixture)).toBe(0)
    expect(hostOf(fixture).textContent).toContain("recap.empty.heading")
  })

  it("closes the detail of a track the filter hides", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit"), unresolvedTrack("b")])
    hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
    await settleScroller(fixture)
    const opened = hostOf(fixture).querySelectorAll("app-track-detail").length

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(opened).toBe(1)
    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(0)
  })

  it("keeps the detail of a track the filter still shows", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit"), unresolvedTrack("b")])
    hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
    await settleScroller(fixture)

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="validated"]')?.click()
    await settleScroller(fixture)

    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(1)
  })

  it("announces the write failures of the displayed tracks", async () => {
    const { fixture, component } = await mountWith([
      written("a", "Dim Orbit"),
      { ...written("b", "Kelvor"), state: "write_error" },
    ])

    expect(component["writeFailures"]()).toBe(1)
    expect(hostOf(fixture).querySelector("[data-write-failures]")).not.toBeNull()
  })

  it("holds the write failures back while a write runs", async () => {
    const { fixture } = await mountWith([{ ...written("a", "Dim Orbit"), state: "write_error" }], {
      writing: signal(true),
    })

    const message = hostOf(fixture).querySelector("[data-write-failures]")

    expect(message).toBeNull()
  })

  it("stays silent about write failures when every track was written", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit")])

    expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
  })

  it("starts a new run from the tagging tab", async () => {
    const { fixture, service, navigate } = await mountWith([written("a", "Dim Orbit")])

    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="new-run"]')?.click()

    expect(service.clearRun).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/tagging")
  })

  it("goes back to the run list without clearing the run", async () => {
    const { fixture, service, navigate } = await mountWith([written("a", "Dim Orbit")])

    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="back"]')?.click()

    expect(navigate).toHaveBeenCalledWith("/tagging")
    expect(service.clearRun).not.toHaveBeenCalled()
  })

  it("shows a framed empty state without a run", async () => {
    const { fixture } = await mountWith([])

    const text = hostOf(fixture).textContent

    expect(text).toContain("recap.none.heading")
    expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="back"]')).not.toBeNull()
  })

  it("disables the run restore while files are busy", async () => {
    const { fixture } = await mountWith([{ ...written("a", "Dim Orbit"), restorable: true }], {
      rollingBack: signal({ runId: "a3f9c1", trackId: "a" }),
    })

    const restore = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="restore-run"]')

    expect(restore?.disabled).toBe(true)
  })

  describe("past run", () => {
    const LOADED: LoadedRun = {
      runId: PAST_RUN.run_id,
      folder: PAST_RUN.folder,
      writtenAt: PAST_RUN.written_at,
      tracks: [loadedTrack(TRACK_LOADED)],
    }

    it("loads a past run once per page", async () => {
      const { service } = await mountWith([], {}, "a3f9c1")

      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith("a3f9c1")
    })

    it("waits for the engine before loading", async () => {
      const available = signal<boolean | null>(null)
      const { service } = await mountWith([], { available }, "a3f9c1")
      const before = service.loadRun.mock.calls.length

      available.set(true)
      TestBed.tick()

      expect(before).toBe(0)
      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith("a3f9c1")
    })

    it("shows skeleton rows until the run is loaded, then its tracks under the context line", async () => {
      const loadedRun = signal<LoadedRun | null>(null)
      const { fixture } = await mountWith([], { loadedRun }, "a3f9c1")
      const waiting = hostOf(fixture).querySelector("app-skeleton-rows")
      const waitingText = hostOf(fixture).textContent

      loadedRun.set(LOADED)
      await settleScroller(fixture)

      expect(waiting).not.toBeNull()
      expect(waitingText).not.toContain("recap.none.heading")
      expect(hostOf(fixture).querySelector("app-skeleton-rows")).toBeNull()
      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).textContent).toContain("settings.admin.rollback.target")
    })

    it("offers no restore and no new run on a past run", async () => {
      const { fixture } = await mountWith(
        [{ ...written("live", "Kelvor"), restorable: true }],
        { loadedRun: signal(LOADED) },
        "a3f9c1",
      )
      hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
      await settleScroller(fixture)

      const offered = ["restore-run", "restore-track", "new-run"].map((name) =>
        hostOf(fixture).querySelector(`[data-action="${name}"]`),
      )

      expect(offered).toEqual([null, null, null])
    })

    it("leaves the write failure message to the live run", async () => {
      const failed = { ...loadedTrack(TRACK_LOADED), state: "write_error" as const }
      const { fixture } = await mountWith(
        [{ ...written("live", "Kelvor"), state: "write_error" }],
        { loadedRun: signal({ ...LOADED, tracks: [failed] }) },
        "a3f9c1",
      )

      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
    })

    it("leaves the rollback failures to the live run", async () => {
      const failedRollback = {
        ...rollbackFinished(),
        failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" as const }],
      }
      const { fixture } = await mountWith(
        [written("live", "Kelvor")],
        { rollbackFinished: signal(failedRollback), loadedRun: signal(LOADED) },
        "a3f9c1",
      )

      expect(hostOf(fixture).querySelector("[data-rollback-failures]")).toBeNull()
    })

    it("replaces the table with the refusal and keeps the way back", async () => {
      const error = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { loadRefusal: signal({ runId: "000000", error }) },
        "000000",
      )

      const text = hostOf(fixture).textContent

      expect(text).toContain("errors.run_not_found")
      expect(text).toContain("recap.past.heading")
      expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
      expect(hostOf(fixture).querySelector('[data-action="back"]')).not.toBeNull()
    })

    it("keeps the skeleton when the refusal belongs to another run", async () => {
      const error = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { loadRefusal: signal({ runId: "000000", error }) },
        "b4c5d6",
      )

      expect(hostOf(fixture).querySelector("app-skeleton-rows")).not.toBeNull()
      expect(hostOf(fixture).textContent).not.toContain("errors.run_not_found")
    })

    it("shows the live run without a run id", async () => {
      const { fixture, component } = await mountWith([written("live", "Kelvor")], {
        loadedRun: signal(LOADED),
      })

      expect(component["tracks"]().map((track) => track.trackId)).toEqual(["live"])
      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).textContent).not.toContain("settings.admin.rollback.target")
    })
  })
})
