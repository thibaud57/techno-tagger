import { signal } from "@angular/core"
import { DeferBlockBehavior, TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { AppComponent } from "./app.component"
import { CloseGuard } from "./core/close-guard.service"
import { SidecarService } from "./core/sidecar.service"

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

  it("installs the close guard at startup", () => {
    const { closeGuard } = mount()

    expect(closeGuard.install).toHaveBeenCalledOnce()
  })
})
