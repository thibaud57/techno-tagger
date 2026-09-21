import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import type { SidecarErrorEvent } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"

import SettingsPageComponent from "./settings-page.component"

/** Sous-ensemble reellement mocke : une divergence avec `SidecarService` casse ici, jamais en silence. */
type SidecarServiceStub = Pick<
  SidecarService,
  "apiKeyConfigured" | "available" | "lastError" | "setApiKey"
>

/**
 * Ce qui se teste ici est la disponibilite de l'enregistrement et la commande
 * emise : la cle ne doit jamais rester dans l'ecran une fois envoyee.
 */
const mountWith = (overrides: Partial<SidecarServiceStub> = {}) => {
  const service: SidecarServiceStub = {
    apiKeyConfigured: signal<boolean | null>(false),
    available: signal(true),
    lastError: signal(null),
    setApiKey: vi.fn(() => Promise.resolve()),
    ...overrides,
  }

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

describe("SettingsPageComponent", () => {
  it.each([
    { configured: true, shown: "settings.api.key.configured", hidden: "settings.api.key.missing" },
    { configured: false, shown: "settings.api.key.missing", hidden: "settings.api.key.configured" },
  ])("shows whether a key is configured ($configured)", ({ configured, shown, hidden }) => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(configured) })

    // Le getter DOM ne rend jamais `null` (TypeScript 6 l'a retype en `string` pur) : `?? ""` serait mort.
    const text = (fixture.nativeElement as HTMLElement).textContent

    expect(text).toContain(shown)
    expect(text).not.toContain(hidden)
  })

  it("shows a key storage error under the row", () => {
    const { fixture } = mountWith({
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "api_key_not_stored",
        params: {},
        message: "",
      }),
    })

    const errorMessage = (fixture.nativeElement as HTMLElement).querySelector("app-error-message")

    expect(errorMessage).not.toBeNull()
  })

  it("ignores an error that does not concern the key", () => {
    const { fixture } = mountWith({
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "vlc_schema_mismatch",
        params: {},
        message: "",
      }),
    })

    const errorMessage = (fixture.nativeElement as HTMLElement).querySelector("app-error-message")

    expect(errorMessage).toBeNull()
  })

  it("disables saving while the field is empty", () => {
    const { component } = mountWith()

    const enabled = component["canSave"]()

    expect(enabled).toBe(false)
  })

  it("sends the key then clears the field", async () => {
    const { component, service } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    await component["save"]()

    expect(service.setApiKey).toHaveBeenCalledWith("k3y-t0k3n")
    expect(component["entry"]().apiKey).toBe("")
  })
})
