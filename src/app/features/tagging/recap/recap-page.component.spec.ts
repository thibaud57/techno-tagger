import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"

import { PAST_RUN, TRACK_LOADED } from "../../../../fixtures/past-runs"
import { type SidecarStubOverrides, sidecarStub } from "../../../../fixtures/sidecar-stub"
import { unresolvedTrack, writtenTrack } from "../../../../fixtures/tagging"
import { settleScroller, stubOffscreenLayout } from "../../../../fixtures/virtual-scroll"
import { ROLLBACK_RUN, commandError, rollbackFinished } from "../../../../fixtures/write"
import { SidecarService } from "../../../core/sidecar/sidecar.service"
import { type LoadedRun, loadedTrack } from "../../../core/stores/past-runs.store"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import RecapPageComponent from "./recap-page.component"

/** Non restaurable : seul un test du run passe pose un morceau restaurable. */
const written = (trackId: string, title: string): TaggingTrack => ({
  ...writtenTrack(trackId, "written", false),
  title,
})

/** Ce qui se teste ici : les morceaux affiches, les filtres, le retour et la ligne de contexte. */
const mountWith = async (
  tracks: readonly TaggingTrack[],
  overrides: SidecarStubOverrides = {},
  runId?: string,
) => {
  const service = sidecarStub({
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? "a3f9c1" : null),
    ...overrides,
  })
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
    const { fixture } = await mountWith([written("a", "Your Mind"), unresolvedTrack("b")])
    const before = rowsIn(fixture)

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(before).toBe(2)
    expect(rowsIn(fixture)).toBe(1)
  })

  it("gives each filter option its count", async () => {
    const { fixture } = await mountWith([
      written("a", "Your Mind"),
      written("b", "Basiel"),
      unresolvedTrack("c"),
    ])

    const counts = [...hostOf(fixture).querySelectorAll("[data-filter] .tabular-nums")].map(
      (count) => count.textContent.trim(),
    )

    expect(counts).toEqual(["3", "2", "0", "1"])
  })

  it("shows the empty state when the search matches nothing", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind")])

    await search(fixture, "basiel")

    expect(rowsIn(fixture)).toBe(0)
    expect(hostOf(fixture).textContent).toContain("recap.empty.heading")
  })

  it("closes the detail of a track the filter hides", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind"), unresolvedTrack("b")])
    hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
    await settleScroller(fixture)
    const opened = hostOf(fixture).querySelectorAll("app-track-detail").length

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(opened).toBe(1)
    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(0)
  })

  it("keeps the detail of a track the filter still shows", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind"), unresolvedTrack("b")])
    hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
    await settleScroller(fixture)

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="validated"]')?.click()
    await settleScroller(fixture)

    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(1)
  })

  it("announces the write failures of the displayed tracks", async () => {
    const { fixture, component } = await mountWith([
      written("a", "Your Mind"),
      { ...written("b", "Basiel"), state: "write_error" },
    ])

    expect(component["writeFailures"]()).toBe(1)
    expect(hostOf(fixture).querySelector("[data-write-failures]")).not.toBeNull()
  })

  it("holds the write failures back while a write runs", async () => {
    const { fixture } = await mountWith([{ ...written("a", "Your Mind"), state: "write_error" }], {
      writing: signal(true),
    })

    const message = hostOf(fixture).querySelector("[data-write-failures]")

    expect(message).toBeNull()
  })

  it("stays silent about write failures when every track was written", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind")])

    expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
  })

  it("goes back to the run list", async () => {
    const { fixture, navigate } = await mountWith([written("a", "Your Mind")])

    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="back"]')?.click()

    expect(navigate).toHaveBeenCalledWith("/tagging")
  })

  it("shows a framed empty state without a run", async () => {
    const { fixture } = await mountWith([])

    const text = hostOf(fixture).textContent

    expect(text).toContain("recap.none.heading")
    expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
    expect(hostOf(fixture).querySelector('[data-action="back"]')).not.toBeNull()
  })

  it("dates the live run by the rollback target of the run just written", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind")], {
      rollbackTarget: signal(ROLLBACK_RUN),
    })

    const context = hostOf(fixture).querySelector("[data-run-context]")

    expect(context).not.toBeNull()
  })

  it("leaves the live run undated when the rollback target is another run", async () => {
    const { fixture } = await mountWith([written("a", "Your Mind")], {
      rollbackTarget: signal({ ...ROLLBACK_RUN, run_id: "b4c5d6" }),
    })

    const context = hostOf(fixture).querySelector("[data-run-context]")

    expect(context).toBeNull()
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

    it("shows skeleton rows until the run is loaded, then its tracks and the context line", async () => {
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

    it("offers no track restore on a past run", async () => {
      const { fixture } = await mountWith(
        [{ ...written("live", "Basiel"), restorable: true }],
        { loadedRun: signal(LOADED) },
        "a3f9c1",
      )
      hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
      await settleScroller(fixture)

      const offered = hostOf(fixture).querySelector('[data-action="restore-track"]')

      expect(offered).toBeNull()
    })

    it("leaves the write failure message to the live run", async () => {
      const failed = { ...loadedTrack(TRACK_LOADED), state: "write_error" as const }
      const { fixture } = await mountWith(
        [{ ...written("live", "Basiel"), state: "write_error" }],
        { loadedRun: signal({ ...LOADED, tracks: [failed] }) },
        "a3f9c1",
      )

      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
    })

    it("leaves the rollback failures to the live run", async () => {
      const failedRollback = rollbackFinished(null, [
        { track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" },
      ])
      const { fixture } = await mountWith(
        [written("live", "Basiel")],
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
      const { fixture, component } = await mountWith([written("live", "Basiel")], {
        loadedRun: signal(LOADED),
      })

      expect(component["tracks"]().map((track) => track.trackId)).toEqual(["live"])
      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).textContent).not.toContain("settings.admin.rollback.target")
    })
  })
})
