import { computed, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"

import { unresolvedTrack, writtenTrack } from "../../../fixtures/tagging"
import { settleScroller, stubOffscreenLayout } from "../../../fixtures/virtual-scroll"
import type { RollbackFinishedEvent } from "../../core/models/protocol"
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
) => {
  const base = {
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? "a3f9c1" : null),
    writing: signal(false),
    rollingBack: signal<RollbackInFlight | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    rollback: vi.fn(() => Promise.resolve()),
    clearRun: vi.fn(),
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
})
