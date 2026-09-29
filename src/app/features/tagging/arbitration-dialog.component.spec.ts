import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { action, page } from "../../../fixtures/dialog"
import { PENDING_TRACK } from "../../../fixtures/tagging"
import type {
  ArbitrationState,
  SidecarCommand,
  SidecarErrorEvent,
} from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { ArbitrationDialogComponent } from "./arbitration-dialog.component"

const ON_BEATPORT: ArbitrationState = {
  track_id: "a.mp3",
  source: "beatport",
  beatport_unavailable: false,
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind (Extended Mix)",
      label: "Drumcode",
      year: 2023,
      scores: { artist: 96, title: 84, average: 90 },
    },
    {
      artist: "Adam Beyer",
      title: "Your Mind (Radio Edit)",
      label: null,
      year: null,
      scores: { artist: null, title: 80, average: 80 },
    },
  ],
  empty_reason: null,
  other_source: null,
}

const AFTER_REFUSAL: ArbitrationState = {
  ...ON_BEATPORT,
  source: "bandcamp",
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind",
      label: null,
      year: null,
      scores: { artist: 100, title: 100, average: 100 },
    },
  ],
  other_source: "beatport",
}

const stub = () => ({
  currentArbitration: signal<ArbitrationState | null>(ON_BEATPORT),
  arbitrationPosition: signal(1),
  arbitrationCount: signal(2),
  arbitrationBusy: signal(false),
  hasPreviousArbitration: signal(false),
  hasNextArbitration: signal(true),
  taggingTracks: signal<readonly TaggingTrack[]>([PENDING_TRACK]),
  lastError: signal<SidecarErrorEvent | null>(null),
  lastErrorCommand: signal<SidecarCommand["command"] | null>(null),
  errorFor: SidecarService.prototype.errorFor,
  chooseCandidate: vi.fn(() => Promise.resolve()),
  refuseCandidates: vi.fn(() => Promise.resolve()),
  showArbitrationSource: vi.fn(() => Promise.resolve()),
  previousArbitration: vi.fn(),
  nextArbitration: vi.fn(),
})

/** Surcharges typees : un `Record<string, unknown>` ferait perdre aux signals leur `set`. */
const mountWith = (overrides: Partial<ReturnType<typeof stub>> = {}) => {
  const service = { ...stub(), ...overrides }
  TestBed.configureTestingModule({
    imports: [ArbitrationDialogComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })
  const fixture = TestBed.createComponent(ArbitrationDialogComponent)
  fixture.componentRef.setInput("visible", true)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

describe("ArbitrationDialogComponent", () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it("shows the candidates of the current arbitration with their score and their label and year", () => {
    mountWith()

    const text = page().textContent

    expect(text).toContain("Adam Beyer - Your Mind (Extended Mix)")
    expect(text).toContain("Drumcode · 2023")
    expect(text).toContain("arbitration.score")
    expect(text).toContain("arbitration.scoreTitleOnly")
  })

  it("omits the label line of a candidate that has none", () => {
    mountWith()

    const releases = page().querySelectorAll("[data-release]")

    expect(releases.length).toBe(1)
  })

  it("falls back on the track id without a run row", () => {
    mountWith({ taggingTracks: signal<readonly TaggingTrack[]>([]) })

    const title = page().querySelector("[data-title]")?.textContent.trim()

    expect(title).toBe("a.mp3")
  })

  it("shows the file name below the title when tags are present", () => {
    mountWith()

    const subtitle = page().querySelector("[data-title]")?.nextElementSibling?.textContent.trim()

    expect(subtitle).toBe("a.mp3")
  })

  it("titles an untagged track like the run list, file name below", () => {
    const { fixture, service } = mountWith()
    service.taggingTracks.set([{ ...PENDING_TRACK, artist: "", title: "" }])
    fixture.detectChanges()

    const title = page().querySelector("[data-title]")

    expect(title?.textContent.trim()).toBe("a")
    expect(title?.nextElementSibling?.textContent.trim()).toBe("a.mp3")
  })

  it("titles a half-tagged track with the tag it has", () => {
    const { fixture, service } = mountWith()
    service.taggingTracks.set([{ ...PENDING_TRACK, title: "" }])
    fixture.detectChanges()

    const title = page().querySelector("[data-title]")

    expect(title?.textContent.trim()).toBe("Adam Beyer")
  })

  it("replaces the Beatport list by the Bandcamp list and offers to go back", () => {
    const { fixture, service } = mountWith()
    service.currentArbitration.set(AFTER_REFUSAL)
    fixture.detectChanges()

    action("back")?.click()

    expect(page().textContent).toContain("arbitration.switched")
    expect(page().textContent).not.toContain("Your Mind (Extended Mix)")
    expect(service.showArbitrationSource).toHaveBeenCalledWith("a.mp3", "beatport")
  })

  it("warns when the candidates come from Bandcamp because Beatport did not answer", () => {
    mountWith({
      currentArbitration: signal<ArbitrationState | null>({
        ...AFTER_REFUSAL,
        beatport_unavailable: true,
        other_source: null,
      }),
    })

    const text = page().textContent

    expect(text).toContain("arbitration.beatportUnavailable")
    expect(action("back")).toBeNull()
  })

  it("offers a single pass action on an empty Bandcamp list with its reason", () => {
    const { service } = mountWith({
      currentArbitration: signal<ArbitrationState | null>({
        ...AFTER_REFUSAL,
        candidates: [],
        empty_reason: "no_result",
      }),
    })

    action("refuse")?.click()

    expect(page().textContent).toContain("arbitration.empty.no_result")
    expect(action("refuse")?.textContent).toContain("arbitration.pass")
    expect(action("validate")?.disabled).toBe(true)
    expect(service.refuseCandidates).toHaveBeenCalledWith("a.mp3", "bandcamp")
  })

  it("validates only a selected candidate, with its source and its index", () => {
    const { fixture, component, service } = mountWith()
    action("validate")?.click()
    const before = vi.mocked(service.chooseCandidate).mock.calls.length
    component["choice"].set({ candidate: 1 })
    fixture.detectChanges()

    action("validate")?.click()

    expect(before).toBe(0)
    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 1)
  })

  it("refuses the shown list with its source", () => {
    const { service } = mountWith()

    action("refuse")?.click()

    expect(service.refuseCandidates).toHaveBeenCalledWith("a.mp3", "beatport")
  })

  it("disables every action while a gesture awaits its answer", () => {
    mountWith({
      currentArbitration: signal<ArbitrationState | null>(AFTER_REFUSAL),
      arbitrationBusy: signal(true),
    })

    const actions = ["refuse", "validate", "back"].map((name) => action(name)?.disabled)

    expect(actions).toEqual([true, true, true])
  })

  it("keeps browsing the queue while a gesture awaits its answer", () => {
    const { service } = mountWith({
      arbitrationBusy: signal(true),
      hasPreviousArbitration: signal(true),
    })

    for (const direction of ["previous", "next"]) {
      page().querySelector<HTMLButtonElement>(`[aria-label="arbitration.${direction}"]`)?.click()
    }

    expect(service.previousArbitration).toHaveBeenCalledOnce()
    expect(service.nextArbitration).toHaveBeenCalledOnce()
  })

  it("shows the wait on the button of the pending gesture only", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()
    action("validate")?.click()

    service.arbitrationBusy.set(true)
    fixture.detectChanges()

    expect(action("validate")?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
    expect(action("refuse")?.querySelector('[data-p-icon="spinner"]')).toBeNull()
  })

  it("changes arbitration with the left and right arrows and validates with Enter", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()
    // Sur le `[role="listbox"]` interne de PrimeNG : seul ce chemin prouve que `onKeydown` ne stoppe pas la propagation.
    const list = page().querySelector<HTMLElement>('[role="listbox"]')

    for (const key of ["ArrowRight", "ArrowLeft", "Enter"]) {
      list?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
    }

    expect(service.nextArbitration).toHaveBeenCalledOnce()
    expect(service.previousArbitration).toHaveBeenCalledOnce()
    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 0)
  })

  it("validates with Enter the candidate reached with the down arrow", () => {
    const { fixture, service } = mountWith()
    TestBed.tick()
    const list = page().querySelector<HTMLElement>('[role="listbox"]')
    list?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }),
    )
    fixture.detectChanges()

    list?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
    )

    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 0)
  })

  it("keeps the clicked candidate when the pointer then passes over another one", () => {
    const { fixture, component } = mountWith()
    TestBed.tick()
    const options = page().querySelectorAll<HTMLElement>('[role="option"]')
    options[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    options[0]?.click()
    fixture.detectChanges()

    options[1]?.dispatchEvent(new MouseEvent("mouseenter"))
    fixture.detectChanges()

    expect(component["choice"]().candidate).toBe(0)
  })

  it("ignores Enter pressed on a button", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()

    action("refuse")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(service.chooseCandidate).not.toHaveBeenCalled()
  })

  it("resets the selection when the current arbitration changes", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 1 })
    fixture.detectChanges()

    service.currentArbitration.set(AFTER_REFUSAL)
    fixture.detectChanges()

    expect(component["choice"]().candidate).toBeNull()
  })

  it("shows only the error of the current track", () => {
    const refusal = (trackId: string): SidecarErrorEvent => ({
      event: "error",
      code: "arbitration_busy",
      params: { track_id: trackId },
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    })
    const { fixture, service } = mountWith({
      lastError: signal<SidecarErrorEvent | null>(refusal("b.mp3")),
      lastErrorCommand: signal<SidecarCommand["command"] | null>("resolve_arbitration"),
    })
    const elsewhere = page().querySelector("app-error-message")

    service.lastError.set(refusal("a.mp3"))
    fixture.detectChanges()

    expect(elsewhere).toBeNull()
    expect(page().querySelector("app-error-message")).not.toBeNull()
  })

  it("dismisses by the cross without any gesture", () => {
    const { fixture, service } = mountWith()
    const dismissed = vi.fn()
    fixture.componentInstance.dismissed.subscribe(dismissed)

    page().querySelector<HTMLButtonElement>('[aria-label="arbitration.close"]')?.click()

    expect(dismissed).toHaveBeenCalledOnce()
    expect(service.chooseCandidate).not.toHaveBeenCalled()
    expect(service.refuseCandidates).not.toHaveBeenCalled()
  })

  it("gives the focus back to the list when shown again", () => {
    const { fixture } = mountWith()
    TestBed.tick()
    fixture.componentRef.setInput("visible", false)
    fixture.detectChanges()
    TestBed.tick()

    fixture.componentRef.setInput("visible", true)
    fixture.detectChanges()
    TestBed.tick()

    expect(document.activeElement?.getAttribute("role")).toBe("listbox")
  })

  it("gives the focus back to the list when a gesture fails on the shown track", () => {
    const { fixture, service } = mountWith()
    TestBed.tick()
    const refuseButton = action("refuse")
    refuseButton?.focus()
    // jsdom ne reproduit pas le retrait de focus qu'un vrai navigateur fait vers <body> a la desactivation.
    refuseButton?.blur()

    service.arbitrationBusy.set(true)
    fixture.detectChanges()
    TestBed.tick()
    service.lastErrorCommand.set("resolve_arbitration")
    service.lastError.set({
      event: "error",
      code: "source_unavailable",
      params: { track_id: "a.mp3" },
      message: "beatport did not answer",
      command: "resolve_arbitration",
    })
    service.arbitrationBusy.set(false)
    fixture.detectChanges()
    TestBed.tick()

    expect(document.activeElement?.getAttribute("role")).toBe("listbox")
  })

  it("gives the focus to the pass action when the list is empty", () => {
    const { fixture, service } = mountWith()
    TestBed.tick()

    service.currentArbitration.set({ ...AFTER_REFUSAL, candidates: [], empty_reason: "no_result" })
    fixture.detectChanges()
    TestBed.tick()

    expect(document.activeElement).toBe(action("refuse"))
  })
})
