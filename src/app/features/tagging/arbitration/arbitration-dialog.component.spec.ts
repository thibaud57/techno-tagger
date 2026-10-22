import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { linkField, page, pasteLink } from "../../../../fixtures/dialog"
import { action, errorMessageOf, heightClassPx } from "../../../../fixtures/dom"
import {
  type SidecarStub,
  type SidecarStubOverrides,
  activeRun,
  commandFailed,
  provideSidecarStub,
  sidecarStub,
} from "../../../../fixtures/sidecar-stub"
import { PENDING_TRACK, arbitrationRequired, unresolvedTrack } from "../../../../fixtures/tagging"
import { TRACK_URL } from "../../../../fixtures/url-recovery"
import { commandError } from "../../../../fixtures/write"
import type { ArbitrationState } from "../../../core/sidecar/protocol"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RecoveryUiStore } from "../url-recovery/recovery-ui.store"

import {
  ArbitrationDialogComponent,
  LIST_HEIGHT_CLASS,
  LIST_SCROLL_HEIGHT,
} from "./arbitration-dialog.component"

const ON_BEATPORT: ArbitrationState = {
  ...arbitrationRequired("a.mp3"),
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

const mountWith = (overrides: SidecarStubOverrides = {}) => {
  const service = sidecarStub({
    // `taggingRunId` est lu par `RecoveryUiStore`, reel ici : l'etape lien en depend.
    ...activeRun(),
    currentArbitration: signal<ArbitrationState | null>(ON_BEATPORT),
    arbitrationCount: signal(2),
    hasNextArbitration: signal(true),
    taggingTracks: signal([PENDING_TRACK]),
    arbitrations: signal([ON_BEATPORT]),
    ...overrides,
  })
  TestBed.configureTestingModule({
    imports: [ArbitrationDialogComponent],
    providers: [provideTranslateService(), provideSidecarStub(service)],
  })
  const fixture = TestBed.createComponent(ArbitrationDialogComponent)
  fixture.componentRef.setInput("visible", true)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

const titleOf = (): Element | null => page().querySelector("[data-title]")

const listbox = (): HTMLElement | null => page().querySelector<HTMLElement>('[role="listbox"]')

/**
 * Sur le `[role="listbox"]` interne de PrimeNG : seul ce chemin prouve que `onKeydown` ne stoppe
 * pas la propagation.
 */
const pressOnList = (key: string): void => {
  listbox()?.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true }))
}

describe("ArbitrationDialogComponent", () => {
  // Une hauteur fixe sous le maximum du scroll decalerait la ligne d'aide.
  it("caps the candidate scroll at the fixed height of the list", () => {
    expect(`${heightClassPx(LIST_HEIGHT_CLASS)}px`).toBe(LIST_SCROLL_HEIGHT)
  })

  it("shows the candidates of the current arbitration with their score, label and year", () => {
    mountWith()

    expect(page().textContent).toContain("Adam Beyer - Your Mind (Extended Mix)")
    expect(page().textContent).toContain("Drumcode · 2023")
    expect(page().textContent).toContain("arbitration.score")
    expect(page().textContent).toContain("arbitration.scoreTitleOnly")
  })

  it("keeps an empty label line under a candidate that has none", () => {
    mountWith()

    expect(
      [...page().querySelectorAll("[data-release]")].map((line) => line.textContent.trim()),
    ).toEqual(["Drumcode · 2023", ""])
  })

  it("falls back on the track id without a run row", () => {
    mountWith({ taggingTracks: signal<readonly TaggingTrack[]>([]) })

    expect(titleOf()?.textContent.trim()).toBe("a.mp3")
  })

  it("shows the file name below the title when tags are present", () => {
    mountWith()

    expect(titleOf()?.nextElementSibling?.textContent.trim()).toBe("a.mp3")
  })

  it("titles an untagged track like the run list", () => {
    const { fixture, service } = mountWith()
    service.taggingTracks.set([{ ...PENDING_TRACK, artist: "", title: "" }])

    fixture.detectChanges()

    expect(titleOf()?.textContent.trim()).toBe("a")
  })

  it("puts the file name below the title of an untagged track", () => {
    const { fixture, service } = mountWith()
    service.taggingTracks.set([{ ...PENDING_TRACK, artist: "", title: "" }])

    fixture.detectChanges()

    expect(titleOf()?.nextElementSibling?.textContent.trim()).toBe("a.mp3")
  })

  it("titles a half-tagged track with the tag it has", () => {
    const { fixture, service } = mountWith()
    service.taggingTracks.set([{ ...PENDING_TRACK, title: "" }])

    fixture.detectChanges()

    expect(titleOf()?.textContent.trim()).toBe("Adam Beyer")
  })

  it("replaces the Beatport list by the Bandcamp list", () => {
    const { fixture, service } = mountWith()
    service.currentArbitration.set(AFTER_REFUSAL)

    fixture.detectChanges()

    expect(page().textContent).toContain("arbitration.switched")
    expect(page().textContent).not.toContain("Your Mind (Extended Mix)")
  })

  it("goes back to the Beatport list on the back action", () => {
    const { fixture, service } = mountWith()
    service.currentArbitration.set(AFTER_REFUSAL)
    fixture.detectChanges()

    action("back")?.click()

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

    expect(page().textContent).toContain("arbitration.beatportUnavailable")
    expect(action("back")).toBeNull()
  })

  describe("on an empty Bandcamp list", () => {
    const mountEmpty = () =>
      mountWith({
        currentArbitration: signal<ArbitrationState | null>({
          ...AFTER_REFUSAL,
          candidates: [],
          empty_reason: "no_result",
        }),
      })

    it("offers a single pass action with its reason", () => {
      mountEmpty()

      expect(page().textContent).toContain("arbitration.empty.no_result")
      expect(action("refuse")?.textContent).toContain("arbitration.pass")
      expect(action("validate")?.disabled).toBe(true)
    })

    it("refuses the list with its source on pass", () => {
      const { service } = mountEmpty()

      action("refuse")?.click()

      expect(service.refuseCandidates).toHaveBeenCalledWith("a.mp3", "bandcamp")
    })
  })

  it("validates nothing without a selected candidate", () => {
    const { service } = mountWith()

    action("validate")?.click()

    expect(service.chooseCandidate).not.toHaveBeenCalled()
  })

  it("validates the selected candidate with its source and its index", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 1 })
    fixture.detectChanges()

    action("validate")?.click()

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

    expect(["refuse", "validate", "back"].map((name) => action(name)?.disabled)).toEqual([
      true,
      true,
      true,
    ])
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

    expect(action("validate")?.querySelector('[data-icon="spinner"]')).not.toBeNull()
    expect(action("refuse")?.querySelector('[data-icon="spinner"]')).toBeNull()
  })

  it("goes to the next arbitration with the right arrow", () => {
    const { service } = mountWith()

    pressOnList("ArrowRight")

    expect(service.nextArbitration).toHaveBeenCalledOnce()
  })

  it("goes to the previous arbitration with the left arrow", () => {
    const { service } = mountWith()

    pressOnList("ArrowLeft")

    expect(service.previousArbitration).toHaveBeenCalledOnce()
  })

  it("validates the selected candidate with Enter", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()

    pressOnList("Enter")

    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 0)
  })

  it("validates with Enter the candidate reached with the down arrow", () => {
    const { fixture, service } = mountWith()
    TestBed.tick()
    pressOnList("ArrowDown")
    fixture.detectChanges()

    pressOnList("Enter")

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

  it("shows the error of the current track", () => {
    mountWith(commandFailed("resolve_arbitration", "arbitration_busy", { track_id: "a.mp3" }))

    expect(errorMessageOf(page())).not.toBeNull()
  })

  it("shows no error of another track", () => {
    mountWith(commandFailed("resolve_arbitration", "arbitration_busy", { track_id: "b.mp3" }))

    expect(errorMessageOf(page())).toBeNull()
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
    service.lastError.set(
      commandError("resolve_arbitration", "source_unavailable", { track_id: "a.mp3" }),
    )
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

  describe("link step", () => {
    const UNRESOLVED = unresolvedTrack("a.mp3")

    /** Refus de la liste Bandcamp : le sidecar retire le morceau de la file et le rend non resolu. */
    const refuseAndLeaveQueue = (
      fixture: { detectChanges: () => void },
      service: SidecarStub,
    ): void => {
      action("refuse")?.click()
      service.arbitrations.set([])
      service.currentArbitration.set(null)
      service.taggingTracks.set([UNRESOLVED])
      service.recoverableTracks.set([UNRESOLVED])
      fixture.detectChanges()
    }

    it("shows the link field and the skip action once the track left the queue unresolved", () => {
      const { fixture, service } = mountWith()

      refuseAndLeaveQueue(fixture, service)

      expect(linkField()).not.toBeNull()
      expect(action("skip")).not.toBeNull()
      expect(action("resolve-url")).not.toBeNull()
      expect(action("refuse")).toBeNull()
    })

    it("shows no queue counter on the link step", () => {
      const { fixture, service } = mountWith()

      refuseAndLeaveQueue(fixture, service)

      expect(page().querySelector("p-badge")).toBeNull()
    })

    it("sends the pasted link for the refused track", () => {
      const { fixture, service } = mountWith()
      refuseAndLeaveQueue(fixture, service)
      pasteLink(TRACK_URL)
      fixture.detectChanges()

      action("resolve-url")?.click()

      expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", TRACK_URL)
    })

    it("leaves the link step on skip", () => {
      const { fixture, service } = mountWith()
      refuseAndLeaveQueue(fixture, service)

      action("skip")?.click()
      fixture.detectChanges()

      expect(TestBed.inject(RecoveryUiStore).linkStep()).toBeNull()
      expect(linkField()).toBeNull()
    })

    it("offers no link step while the refused track awaits its Bandcamp list", () => {
      const { fixture, service } = mountWith()
      action("refuse")?.click()
      service.currentArbitration.set(AFTER_REFUSAL)
      service.arbitrations.set([AFTER_REFUSAL])

      fixture.detectChanges()

      expect(linkField()).toBeNull()
      expect(action("skip")).toBeNull()
      expect(page().textContent).toContain("Your Mind")
    })
  })
})
