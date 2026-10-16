import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"
import { vi } from "vitest"

import { type Hosted, action, hostOf } from "../../../../fixtures/dom"
import { OTHER_PAST_RUN, PAST_RUN, TRACK_LOADED } from "../../../../fixtures/past-runs"
import { stubNavigation } from "../../../../fixtures/router"
import {
  type SidecarStubOverrides,
  provideSidecarStub,
  sidecarStub,
} from "../../../../fixtures/sidecar-stub"
import { RUN_ID, unresolvedTrack, writtenTrack } from "../../../../fixtures/tagging"
import {
  settleScroller,
  stubOffscreenLayout,
  toggleOf,
  togglesOf,
} from "../../../../fixtures/virtual-scroll"
import { ROLLBACK_RUN, commandError, failedRollback } from "../../../../fixtures/write"
import { type LoadedRun, loadedTrack } from "../../../core/stores/past-runs.store"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import RecapPageComponent from "./recap-page.component"

const OTHER_ROLLBACK_RUN = { ...ROLLBACK_RUN, run_id: OTHER_PAST_RUN.run_id }

/** Non restaurable : seul un test du run passe pose un morceau restaurable. */
const writtenAs = (trackId: string, title: string): TaggingTrack => ({
  ...writtenTrack(trackId, "written", false),
  title,
})

const mountWith = async (
  tracks: readonly TaggingTrack[],
  overrides: SidecarStubOverrides = {},
  runId?: string,
) => {
  const service = sidecarStub({
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? RUN_ID : null),
    ...overrides,
  })
  TestBed.configureTestingModule({
    imports: [RecapPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      provideSidecarStub(service),
    ],
  })
  const navigate = stubNavigation("navigateByUrl")
  const fixture = TestBed.createComponent(RecapPageComponent)
  if (runId !== undefined) {
    fixture.componentRef.setInput("runId", runId)
  }
  fixture.detectChanges()
  await settleScroller(fixture)

  return { fixture, component: fixture.componentInstance, service, navigate }
}

const search = async (fixture: Hosted & { detectChanges: () => void }, text: string) => {
  const field = hostOf(fixture).querySelector<HTMLInputElement>('input[data-field="search"]')
  if (!field) {
    throw new Error("recherche introuvable dans le recapitulatif")
  }
  field.value = text
  field.dispatchEvent(new Event("input"))
  await settleScroller(fixture)
}

const filter = async (fixture: Hosted & { detectChanges: () => void }, name: string) => {
  hostOf(fixture).querySelector<HTMLElement>(`[data-filter="${name}"]`)?.click()
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
    const { fixture } = await mountWith([writtenAs("a", "Your Mind"), unresolvedTrack("b")])

    await filter(fixture, "failed")

    expect(togglesOf(fixture)).toHaveLength(1)
  })

  it("gives each filter option its count", async () => {
    const { fixture } = await mountWith([
      writtenAs("a", "Your Mind"),
      writtenAs("b", "Basiel"),
      unresolvedTrack("c"),
    ])

    expect(
      [...hostOf(fixture).querySelectorAll("[data-filter] .tabular-nums")].map((count) =>
        count.textContent.trim(),
      ),
    ).toEqual(["3", "2", "0", "1"])
  })

  it("shows the empty state when the search matches nothing", async () => {
    const { fixture } = await mountWith([writtenAs("a", "Your Mind")])

    await search(fixture, "basiel")

    expect(togglesOf(fixture)).toHaveLength(0)
    expect(hostOf(fixture).textContent).toContain("recap.empty.heading")
  })

  it("closes the detail of a track the filter hides", async () => {
    const { fixture } = await mountWith([writtenAs("a", "Your Mind"), unresolvedTrack("b")])
    toggleOf(fixture)?.click()
    await settleScroller(fixture)

    await filter(fixture, "failed")

    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(0)
  })

  it("keeps the detail of a track the filter still shows", async () => {
    const { fixture } = await mountWith([writtenAs("a", "Your Mind"), unresolvedTrack("b")])
    toggleOf(fixture)?.click()
    await settleScroller(fixture)

    await filter(fixture, "validated")

    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(1)
  })

  it("announces the write failures of the displayed tracks", async () => {
    const { fixture, component } = await mountWith([
      writtenAs("a", "Your Mind"),
      { ...writtenAs("b", "Basiel"), state: "write_error" },
    ])

    expect(component["writeFailures"]()).toBe(1)
    expect(hostOf(fixture).querySelector("[data-write-failures]")).not.toBeNull()
  })

  it.each([
    {
      case: "a write runs",
      tracks: [{ ...writtenAs("a", "Your Mind"), state: "write_error" as const }],
      overrides: { writing: signal(true) },
    },
    { case: "every track was written", tracks: [writtenAs("a", "Your Mind")], overrides: {} },
  ])("shows no write failure message when $case", async ({ tracks, overrides }) => {
    const { fixture } = await mountWith(tracks, overrides)

    expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
  })

  it("goes back to the run list", async () => {
    const { fixture, navigate } = await mountWith([writtenAs("a", "Your Mind")])

    action("back", hostOf(fixture))?.click()

    expect(navigate).toHaveBeenCalledWith("/tagging")
  })

  it("shows a framed empty state without a run", async () => {
    const { fixture } = await mountWith([])

    expect(hostOf(fixture).textContent).toContain("recap.none.heading")
    expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
    expect(action("back", hostOf(fixture))).not.toBeNull()
  })

  // La restauration d'un run fait passer la cible au run precedent, sans changer
  // l'ecriture du run affiche.
  it.each([
    { case: "the rollback target is this run", target: ROLLBACK_RUN },
    { case: "the rollback target moved to the previous run", target: OTHER_ROLLBACK_RUN },
    { case: "no run is left to restore", target: null },
  ])("dates the live run by its past runs entry when $case", async ({ target }) => {
    const { fixture } = await mountWith([writtenAs("a", "Your Mind")], {
      pastRuns: signal([PAST_RUN]),
      rollbackTarget: signal(target),
    })

    expect(hostOf(fixture).querySelector("[data-run-context]")).not.toBeNull()
  })

  it("leaves the live run undated when the past runs do not list it", async () => {
    const { fixture } = await mountWith([writtenAs("a", "Your Mind")], {
      pastRuns: signal([OTHER_PAST_RUN]),
      rollbackTarget: signal(ROLLBACK_RUN),
    })

    expect(hostOf(fixture).querySelector("[data-run-context]")).toBeNull()
  })

  describe("past run", () => {
    const LOADED: LoadedRun = {
      runId: PAST_RUN.run_id,
      folder: PAST_RUN.folder,
      writtenAt: PAST_RUN.written_at,
      tracks: [loadedTrack(TRACK_LOADED)],
    }

    it("loads a past run once per page", async () => {
      const { service } = await mountWith([], {}, RUN_ID)

      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith(RUN_ID)
    })

    it("does not load a past run before the engine answers", async () => {
      const { service } = await mountWith([], { available: signal<boolean | null>(null) }, RUN_ID)

      expect(service.loadRun).not.toHaveBeenCalled()
    })

    it("loads the past run once the engine is ready", async () => {
      const available = signal<boolean | null>(null)
      const { service } = await mountWith([], { available }, RUN_ID)

      available.set(true)
      TestBed.tick()

      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith(RUN_ID)
    })

    it("shows skeleton rows until the run is loaded", async () => {
      const { fixture } = await mountWith([], { loadedRun: signal<LoadedRun | null>(null) }, RUN_ID)

      expect(hostOf(fixture).querySelector("app-skeleton-rows")).not.toBeNull()
      expect(hostOf(fixture).textContent).not.toContain("recap.none.heading")
    })

    it("shows the tracks and the context line once the run is loaded", async () => {
      const loadedRun = signal<LoadedRun | null>(null)
      const { fixture } = await mountWith([], { loadedRun }, RUN_ID)

      loadedRun.set(LOADED)
      await settleScroller(fixture)

      expect(hostOf(fixture).querySelector("app-skeleton-rows")).toBeNull()
      expect(togglesOf(fixture)).toHaveLength(1)
      expect(hostOf(fixture).textContent).toContain("settings.admin.rollback.target")
    })

    it("offers no track restore on a past run", async () => {
      const { fixture } = await mountWith(
        [{ ...writtenAs("live", "Basiel"), restorable: true }],
        { loadedRun: signal(LOADED) },
        RUN_ID,
      )
      toggleOf(fixture)?.click()
      await settleScroller(fixture)

      expect(action("restore-track", hostOf(fixture))).toBeNull()
    })

    it("leaves the write failure message to the live run", async () => {
      const failed = { ...loadedTrack(TRACK_LOADED), state: "write_error" as const }
      const { fixture } = await mountWith(
        [{ ...writtenAs("live", "Basiel"), state: "write_error" }],
        { loadedRun: signal({ ...LOADED, tracks: [failed] }) },
        RUN_ID,
      )

      expect(togglesOf(fixture)).toHaveLength(1)
      expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
    })

    it("leaves the rollback failures to the live run", async () => {
      const { fixture } = await mountWith(
        [writtenAs("live", "Basiel")],
        { rollbackFinished: signal(failedRollback()), loadedRun: signal(LOADED) },
        RUN_ID,
      )

      expect(hostOf(fixture).querySelector("[data-rollback-failures]")).toBeNull()
    })

    it("replaces the table with the refusal", async () => {
      const error = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { loadRefusal: signal({ runId: "000000", error }) },
        "000000",
      )

      expect(hostOf(fixture).textContent).toContain("errors.run_not_found")
      expect(hostOf(fixture).textContent).toContain("recap.past.heading")
      expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
    })

    it("keeps the way back on a refused run", async () => {
      const error = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { loadRefusal: signal({ runId: "000000", error }) },
        "000000",
      )

      expect(action("back", hostOf(fixture))).not.toBeNull()
    })

    it("keeps the skeleton when the refusal belongs to another run", async () => {
      const error = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { loadRefusal: signal({ runId: "000000", error }) },
        OTHER_PAST_RUN.run_id,
      )

      expect(hostOf(fixture).querySelector("app-skeleton-rows")).not.toBeNull()
      expect(hostOf(fixture).textContent).not.toContain("errors.run_not_found")
    })

    it("shows the live run without a run id", async () => {
      const { fixture, component } = await mountWith([writtenAs("live", "Basiel")], {
        loadedRun: signal(LOADED),
      })

      expect(component["tracks"]().map((track) => track.trackId)).toEqual(["live"])
      expect(togglesOf(fixture)).toHaveLength(1)
      expect(hostOf(fixture).textContent).not.toContain("settings.admin.rollback.target")
    })
  })
})
