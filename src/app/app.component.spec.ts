import { Component, type Provider } from "@angular/core"
import { DeferBlockBehavior, TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"
import { vi } from "vitest"

import { closeGuardStub } from "../fixtures/close-guard"
import { type Hosted, hostOf } from "../fixtures/dom"
import { stubNavigation } from "../fixtures/router"
import { activeRun, provideSidecarStub, sidecarStub } from "../fixtures/sidecar-stub"
import { recoveredTrack, unresolvedTrack } from "../fixtures/tagging"
import { availableUpdate, updaterStub } from "../fixtures/updater"
import { AppComponent } from "./app.component"
import { APP_BANNER, APP_EDITION } from "./core/platform/app-edition"
import { CloseGuard } from "./core/platform/close-guard.service"
import { UpdateService } from "./core/platform/update.service"
import { APP_UPDATER, type AvailableUpdate } from "./core/platform/updater"
import { RecoveryUiStore } from "./features/tagging/url-recovery/recovery-ui.store"

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

const mount = (
  update: AvailableUpdate | null = null,
  url: string | null = null,
  extraProviders: Provider[] = [],
) => {
  // `RecoveryUiStore`, reel ici, lit le run : le badge et la modale du lien en dependent.
  const service = sidecarStub(activeRun())
  const closeGuard = closeGuardStub()
  TestBed.configureTestingModule({
    imports: [AppComponent],
    // Les deux modales ont leurs propres tests : ici, seule leur visibilite compte.
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      provideTranslateService(),
      // `p-toast` du shell l'injecte ; l'application le fournit a la racine (app.config.ts).
      MessageService,
      provideSidecarStub(service),
      { provide: CloseGuard, useValue: closeGuard },
      { provide: APP_UPDATER, useValue: updaterStub(update) },
      ...extraProviders,
    ],
  })
  if (url !== null) {
    // Aucune route n'est declaree ici : l'URL est posee, l'onglet actif en est derive.
    vi.spyOn(TestBed.inject(Router), "url", "get").mockReturnValue(url)
  }
  const fixture = TestBed.createComponent(AppComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service, closeGuard }
}

const badge = (fixture: Hosted): HTMLButtonElement | null =>
  hostOf(fixture).querySelector<HTMLButtonElement>("[data-arbitration-badge]")

const recoveryBadge = (fixture: Hosted): HTMLButtonElement | null =>
  hostOf(fixture).querySelector<HTMLButtonElement>("[data-recovery-badge]")

const updateBadge = (fixture: Hosted): HTMLButtonElement | null =>
  hostOf(fixture).querySelector<HTMLButtonElement>("[data-update-badge]")

const tabsOf = (fixture: Hosted): HTMLElement[] =>
  Array.from(hostOf(fixture).querySelectorAll<HTMLElement>("p-tab"))

/** Un morceau a rattraper derriere un morceau deja rattrape : le badge vise le second. */
const mountWithRecoverableTracks = () => {
  const mounted = mount()
  mounted.service.recoverableTracks.set([recoveredTrack("a.mp3"), unresolvedTrack("b.mp3")])
  mounted.fixture.detectChanges()

  return { ...mounted, navigate: stubNavigation("navigate") }
}

@Component({ selector: "app-test-banner", template: "banner" })
class TestBannerComponent {}

describe("AppComponent", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("names the icon-only settings tab for assistive technologies", () => {
    const { fixture } = mount()

    expect(tabsOf(fixture).at(-1)?.getAttribute("aria-label")).toBe("nav.settings")
  })

  // Le nom de l'application et les badges sont des freres des onglets dans le DOM.
  it("wraps the arrow keys from the settings tab to the first tab, past the name and the badges", () => {
    const { fixture } = mount()
    const [first, , settings] = tabsOf(fixture)
    settings?.focus()

    settings?.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true }))

    expect(document.activeElement).toBe(first)
  })

  // Cliquer l'onglet actif ne change pas le modele de `p-tabs` : aucun `valueChange`.
  it.each([
    {
      case: "returns to the list when the active tab is clicked on /tagging/recap",
      url: "/tagging/recap",
      tab: 1,
      navigations: [[["tagging"]]],
    },
    {
      case: "returns to the list when the active tab is clicked on /tagging/recap/a3f9c1",
      url: "/tagging/recap/a3f9c1",
      tab: 1,
      navigations: [[["tagging"]]],
    },
    {
      case: "does not navigate when the active tab is clicked on its own route",
      url: "/tagging",
      tab: 1,
      navigations: [],
    },
    {
      case: "navigates once when another tab is clicked from a subpage",
      url: "/tagging/recap",
      tab: 0,
      navigations: [[["playlist"]]],
    },
  ])("$case", ({ url, tab, navigations }) => {
    const { fixture } = mount(null, url)
    const navigate = stubNavigation("navigate")

    tabsOf(fixture)[tab]?.click()

    expect(navigate.mock.calls).toEqual(navigations)
  })

  it("keeps the arbitration dialog closed on an empty queue", () => {
    const { component } = mount()

    expect(component["arbitrationVisible"]()).toBe(false)
  })

  it("opens the arbitration dialog as soon as the queue fills", () => {
    const { component, service } = mount()

    service.arbitrationCount.set(1)

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("keeps the arbitration dialog closed when the queue grows after the cross", () => {
    const { component, service } = mount()
    service.arbitrationCount.set(1)
    component["dismissArbitration"]()

    service.arbitrationCount.set(2)

    expect(component["arbitrationVisible"]()).toBe(false)
  })

  it("shows the queue badge once the cross has closed the dialog", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(2)
    component["dismissArbitration"]()

    fixture.detectChanges()

    expect(badge(fixture)?.textContent).toContain("arbitration.badge")
  })

  it("reopens the arbitration dialog on a click on the queue badge", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(2)
    component["dismissArbitration"]()
    fixture.detectChanges()

    badge(fixture)?.click()

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("reopens the arbitration dialog once the queue has emptied and filled again", () => {
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

  it("reopens the arbitration dialog when a run row asks for it after the cross", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(2)
    component["dismissArbitration"]()
    fixture.detectChanges()

    service.arbitrationOpenings.update((count) => count + 1)

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it.each([
    { case: "hides the queue badge on an empty queue", find: badge },
    { case: "shows no update badge without an update", find: updateBadge },
  ])("$case", ({ find }) => {
    const { fixture } = mount()

    expect(find(fixture)).toBeNull()
  })

  it.each([
    { case: "nothing is left to recover", tracks: [recoveredTrack("a.mp3")], tagging: false },
    { case: "a search runs", tracks: [unresolvedTrack("a.mp3")], tagging: true },
  ])("hides the recovery badge when $case", ({ tracks, tagging }) => {
    const { fixture, service } = mount()
    service.recoverableTracks.set(tracks)
    service.tagging.set(tagging)

    fixture.detectChanges()

    expect(recoveryBadge(fixture)).toBeNull()
  })

  it("counts the unresolved tracks only in the recovery badge", () => {
    const { fixture, service } = mount()
    service.recoverableTracks.set([
      unresolvedTrack("a.mp3"),
      recoveredTrack("b.mp3"),
      unresolvedTrack("c.mp3"),
    ])

    fixture.detectChanges()

    expect(recoveryBadge(fixture)?.textContent).toContain("tagging.recovery.badge")
    expect(TestBed.inject(RecoveryUiStore).unresolvedCount()).toBe(2)
  })

  it("opens the link dialog on the first unresolved track on a recovery badge click", () => {
    const { fixture } = mountWithRecoverableTracks()

    recoveryBadge(fixture)?.click()

    expect(TestBed.inject(RecoveryUiStore).target()).toBe("b.mp3")
  })

  it("goes to the tagging page on a recovery badge click", () => {
    const { fixture, navigate } = mountWithRecoverableTracks()

    recoveryBadge(fixture)?.click()

    expect(navigate).toHaveBeenCalledWith(["tagging"])
  })

  it("keeps the arbitration dialog open on the link step of an emptied queue", () => {
    const { fixture, component, service } = mount()
    service.taggingTracks.set([unresolvedTrack("a.mp3")])
    service.recoverableTracks.set([unresolvedTrack("a.mp3")])
    TestBed.inject(RecoveryUiStore).refused("a.mp3")

    fixture.detectChanges()

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("shows the update badge after later and reopens the dialog on click", async () => {
    const { fixture, component } = mount(availableUpdate())
    const updates = TestBed.inject(UpdateService)
    await updates.check()
    updates.dismiss()
    fixture.detectChanges()

    updateBadge(fixture)?.click()

    expect(component["updateDialogVisible"]()).toBe(true)
  })

  it("hides the window controls in the demo edition", () => {
    const { fixture } = mount(null, null, [{ provide: APP_EDITION, useValue: "demo" }])

    expect(hostOf(fixture).querySelector("app-window-controls")).toBeNull()
  })

  it("hides the separator before the window controls in the demo edition", () => {
    const { fixture } = mount(null, null, [{ provide: APP_EDITION, useValue: "demo" }])

    expect(hostOf(fixture).querySelector("span.order-3")).toBeNull()
  })

  it("keeps the separator before the window controls in the desktop edition", () => {
    const { fixture } = mount()

    expect(hostOf(fixture).querySelector("span.order-3")).not.toBeNull()
  })

  it("shows the window controls in the desktop edition", () => {
    const { fixture } = mount()

    expect(hostOf(fixture).querySelector("app-window-controls")).not.toBeNull()
  })

  it("renders the provided banner between the tabs and the page", () => {
    const { fixture } = mount(null, null, [{ provide: APP_BANNER, useValue: TestBannerComponent }])

    const banner = hostOf(fixture).querySelector("app-test-banner")

    expect(banner?.nextElementSibling?.tagName).toBe("MAIN")
  })

  it("renders no banner by default", () => {
    const { fixture } = mount()

    expect(hostOf(fixture).querySelector("app-test-banner")).toBeNull()
  })

  it("installs the close guard at startup", () => {
    const { closeGuard } = mount()

    expect(closeGuard.install).toHaveBeenCalledOnce()
  })
})
