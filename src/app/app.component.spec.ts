import { signal } from "@angular/core"
import { DeferBlockBehavior, TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { AppComponent } from "./app.component"
import { CloseGuard } from "./core/close-guard.service"
import { PENDING_TRACK } from "../fixtures/tagging"

import { SidecarService } from "./core/sidecar.service"
import type { TaggingTrack } from "./core/tagging-run.store"
import { RecoveryUiStore } from "./features/tagging/recovery-ui.store"

/** jsdom n'implemente pas `ResizeObserver` qu'observe `p-tablist` (jsdom/jsdom#3368). */
class ResizeObserverStub {
  observe(): void {
    return
  }
  unobserve(): void {
    return
  }
  disconnect(): void {
    return
  }
}
;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

const mount = () => {
  const service = {
    available: signal<boolean | null>(true),
    versionMismatch: signal(null),
    arbitrationCount: signal(0),
    arbitrationOpenings: signal(0),
    // Lus par `RecoveryUiStore`, reel ici : le badge et la modale du lien en dependent.
    taggingRunId: signal<string | null>("run-1"),
    arbitrations: signal<readonly { track_id: string }[]>([]),
    tagging: signal(false),
    taggingTracks: signal<readonly TaggingTrack[]>([]),
    recoverableTracks: signal<readonly TaggingTrack[]>([]),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set()),
  }
  const closeGuard = {
    install: vi.fn(() => Promise.resolve()),
    request: signal(null),
    stay: vi.fn(),
    leave: vi.fn(() => Promise.resolve()),
  }
  TestBed.configureTestingModule({
    imports: [AppComponent],
    // Les deux modales ont leurs propres tests : ici, seule leur visibilite compte.
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      provideTranslateService(),
      // `p-toast` du shell l'injecte ; l'application le fournit a la racine (app.config.ts).
      MessageService,
      { provide: SidecarService, useValue: service },
      { provide: CloseGuard, useValue: closeGuard },
    ],
  })
  const fixture = TestBed.createComponent(AppComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service, closeGuard }
}

const badge = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>("[data-arbitration-badge]")

const recoveryBadge = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>("[data-recovery-badge]")

const unresolved = (trackId: string): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  state: "unresolved",
  resolution: "none",
  failureReason: "user_refused",
})

const recovered = (trackId: string): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  state: "resolved",
  resolution: "url",
  source: "bandcamp",
})

describe("AppComponent", () => {
  it("opens the arbitration dialog as soon as the queue fills", () => {
    const { component, service } = mount()
    const before = component["arbitrationVisible"]()

    service.arbitrationCount.set(1)

    expect(before).toBe(false)
    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("keeps it closed after the cross until the queue badge is clicked", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(1)
    component["dismissArbitration"]()
    service.arbitrationCount.set(2)
    fixture.detectChanges()
    const suspended = component["arbitrationVisible"]()
    const label = badge(fixture.nativeElement as HTMLElement)?.textContent

    badge(fixture.nativeElement as HTMLElement)?.click()

    expect(suspended).toBe(false)
    expect(label).toContain("arbitration.badge")
    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("opens it again once the queue has emptied and filled again", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(1)
    component["dismissArbitration"]()
    service.arbitrationCount.set(0)
    // Rendu intermediaire : sans lecture pendant que la file est vide, `linkedSignal`
    // ne voit pas passer le zero.
    fixture.detectChanges()

    service.arbitrationCount.set(1)

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("opens it again when a run row asks for its arbitration after the cross", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(2)
    component["dismissArbitration"]()
    fixture.detectChanges()

    service.arbitrationOpenings.update((count) => count + 1)

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("hides the queue badge on an empty queue", () => {
    const { fixture } = mount()

    const found = badge(fixture.nativeElement as HTMLElement)

    expect(found).toBeNull()
  })

  it("hides the recovery badge when nothing is left to recover", () => {
    const { fixture, service } = mount()
    service.recoverableTracks.set([recovered("a.mp3")])

    fixture.detectChanges()

    expect(recoveryBadge(fixture.nativeElement as HTMLElement)).toBeNull()
  })

  it("hides the recovery badge during a search", () => {
    const { fixture, service } = mount()
    service.recoverableTracks.set([unresolved("a.mp3")])
    service.tagging.set(true)

    fixture.detectChanges()

    expect(recoveryBadge(fixture.nativeElement as HTMLElement)).toBeNull()
  })

  it("counts the unresolved tracks only in the recovery badge", () => {
    const { fixture, service } = mount()
    service.recoverableTracks.set([unresolved("a.mp3"), recovered("b.mp3"), unresolved("c.mp3")])

    fixture.detectChanges()

    const label = recoveryBadge(fixture.nativeElement as HTMLElement)?.textContent
    expect(label).toContain("tagging.recovery.badge")
    expect(TestBed.inject(RecoveryUiStore).unresolvedCount()).toBe(2)
  })

  it("opens the link dialog on the first unresolved track and goes to the tagging page on a badge click", () => {
    const { fixture, service } = mount()
    service.recoverableTracks.set([recovered("a.mp3"), unresolved("b.mp3")])
    fixture.detectChanges()
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true)

    recoveryBadge(fixture.nativeElement as HTMLElement)?.click()

    expect(TestBed.inject(RecoveryUiStore).target()).toBe("b.mp3")
    expect(navigate).toHaveBeenCalledWith(["tagging"])
  })

  it("keeps the arbitration dialog open on the link step of an emptied queue", () => {
    const { fixture, component, service } = mount()
    const recovery = TestBed.inject(RecoveryUiStore)
    service.taggingTracks.set([unresolved("a.mp3")])
    recovery.refused("a.mp3")
    fixture.detectChanges()

    const visible = component["arbitrationVisible"]()

    expect(visible).toBe(true)
  })

  it("installs the close guard at startup", () => {
    const { closeGuard } = mount()

    expect(closeGuard.install).toHaveBeenCalledOnce()
  })
})
