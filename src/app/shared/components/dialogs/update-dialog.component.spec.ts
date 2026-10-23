import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { dialogLabel, page } from "../../../../fixtures/dialog"
import { action } from "../../../../fixtures/dom"
import { type NativeStub, nativeStub } from "../../../../fixtures/native-stub"
import {
  provideSidecarStub,
  sidecarStub,
  type SidecarStubOverrides,
} from "../../../../fixtures/sidecar-stub"
import { preferencesStub } from "../../../../fixtures/preferences-stub"
import { translateWith } from "../../../../fixtures/translate"
import {
  availableUpdate,
  failingUpdate,
  hangingUpdate,
  updaterStub,
} from "../../../../fixtures/updater"
import { NativeService } from "../../../core/platform/native.service"
import { PreferencesService } from "../../../core/platform/preferences.service"
import { UpdateService } from "../../../core/platform/update.service"
import { APP_UPDATER, type AvailableUpdate } from "../../../core/platform/updater"

import { UpdateDialogComponent } from "./update-dialog.component"

let native: NativeStub

beforeEach(() => {
  native = nativeStub()
})

const mount = async (
  update: AvailableUpdate = availableUpdate(),
  overrides: SidecarStubOverrides = {},
  preferences = preferencesStub(),
) => {
  TestBed.configureTestingModule({
    imports: [UpdateDialogComponent],
    providers: [
      provideTranslateService(),
      { provide: PreferencesService, useValue: preferences },
      { provide: APP_UPDATER, useValue: updaterStub(update) },
      provideSidecarStub(sidecarStub(overrides)),
      { provide: NativeService, useValue: native },
    ],
  })
  const service = TestBed.inject(UpdateService)
  await service.check()
  const fixture = TestBed.createComponent(UpdateDialogComponent)
  fixture.detectChanges()

  return { fixture, service }
}

const cross = (): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>('[aria-label="update.later"]')

const neverEnding = (total: number | null = 10_000_000): AvailableUpdate =>
  hangingUpdate({ received: 4_000_000, total })

describe("UpdateDialogComponent", () => {
  it("shows both versions with later and install", async () => {
    const { fixture } = await mount()
    translateWith({ update: { available: "{{version}} over {{current}}" } })

    fixture.detectChanges()

    expect(page().textContent).toContain("2.0.0 over 1.0.0")
    expect(action("later")).not.toBeNull()
    expect(action("install")).not.toBeNull()
  })

  it.each([
    ["later", () => action("later")],
    ["the cross", cross],
  ])("sends the update to the badge on %s", async (_, dismiss) => {
    const { service } = await mount()

    dismiss()?.click()

    expect(service.badgeVisible()).toBe(true)
  })

  it("names the dialog by its title", async () => {
    await mount()

    expect(dialogLabel()?.textContent).toContain("update.title")
  })

  // Sans focus dans la modale, Tab parcourt la page derriere le masque.
  it("puts the initial focus inside the dialog, on no button", async () => {
    const { fixture } = await mount()

    await fixture.whenStable()

    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).not.toBeInstanceOf(HTMLButtonElement)
  })

  it("disables install while the engine is busy", async () => {
    // Trouvee pendant un travail, la mise a jour part au badge : la modale est rouverte par lui.
    const { fixture, service } = await mount(availableUpdate(), { writing: signal(true) })
    service.reopen()

    fixture.detectChanges()

    expect(action("install")?.disabled).toBe(true)
  })

  it("replaces the body with the progress while downloading", async () => {
    const { fixture } = await mount(neverEnding())

    action("install")?.click()
    fixture.detectChanges()

    expect(page().querySelector("app-phase-progress")).not.toBeNull()
    expect(action("install")).toBeNull()
    expect(action("later")).toBeNull()
    expect(cross()).toBeNull()
  })

  // PrimeNG ne lit `closeOnEscape` qu'a l'ouverture : Echap ferme sinon la modale en plein telechargement.
  it("keeps the dialog on Escape while downloading, so the failure still shows in it", async () => {
    let fail: (error: Error) => void = () => undefined
    const update = availableUpdate({
      downloadAndInstall: vi.fn(
        () =>
          new Promise<void>((_, reject) => {
            fail = reject
          }),
      ),
    })
    const { fixture, service } = await mount(update)
    action("install")?.click()
    await vi.waitFor(() => {
      expect(update.downloadAndInstall).toHaveBeenCalled()
    })
    fixture.detectChanges()

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    fail(new Error("signature"))
    await vi.waitFor(() => {
      expect(service.state().kind).toBe("failed")
    })

    expect(service.dialogVisible()).toBe(true)
  })

  it("shows the failure with a retry", async () => {
    const { fixture, service } = await mount(failingUpdate())

    action("install")?.click()
    await vi.waitFor(() => {
      expect(service.state().kind).toBe("failed")
    })
    fixture.detectChanges()

    expect(page().textContent).toContain("update.failed")
    expect(action("install")?.textContent).toContain("update.retry")
    expect(action("later")).not.toBeNull()
  })

  it("shows the failure note and retry after an installation that did not complete", async () => {
    const attempt = preferencesStub({ updateAttempt: { from: APP_VERSION, to: "2.0.0" } })
    const { fixture } = await mount(availableUpdate(), {}, attempt)

    fixture.detectChanges()

    const note = page().querySelector("app-message")
    expect(note?.querySelector("p-message")?.classList.contains("p-message-warn")).toBe(true)
    expect(note?.textContent).toContain("update.installFailed")
    expect(action("install")?.textContent).toContain("update.retry")
  })

  it("shows no failure note without a failed installation", async () => {
    const { fixture } = await mount()

    fixture.detectChanges()

    expect(page().querySelector("app-message")).toBeNull()
    expect(action("install")?.textContent).toContain("update.install")
  })

  it("shows an indeterminate bar and no counter while the total is unknown", async () => {
    const { fixture } = await mount(neverEnding(null))
    translateWith({ update: { counter: "{{received}} of {{total}}" } })

    action("install")?.click()
    fixture.detectChanges()

    const bar = page().querySelector("app-phase-progress p-progressbar")
    expect(bar?.classList.contains("p-progressbar-indeterminate")).toBe(true)
    expect(page().querySelector("app-phase-progress .tabular-nums")).toBeNull()
  })

  it("shows the counter and a determinate bar once the total is known", async () => {
    const { fixture, service } = await mount(neverEnding())
    translateWith({ update: { counter: "{{received}} of {{total}}" } })

    action("install")?.click()
    await vi.waitFor(() => {
      expect(service.state()).toMatchObject({ progress: { received: 4_000_000 } })
    })
    fixture.detectChanges()

    const bar = page().querySelector("app-phase-progress p-progressbar")
    const counter = page().querySelector("app-phase-progress .tabular-nums")
    expect(bar?.classList.contains("p-progressbar-determinate")).toBe(true)
    expect(bar?.getAttribute("aria-valuenow")).toBe("40")
    expect(counter?.textContent).toBe("4 MB of 10 MB")
  })

  it("opens the release page from the notes link", async () => {
    await mount()

    action("notes")?.click()

    expect(native.openUrl).toHaveBeenCalledWith("https://example.com/releases/tag/v2.0.0")
  })

  it("hides the notes link without a release page", async () => {
    await mount(availableUpdate({ releasePage: null }))

    expect(action("notes")).toBeNull()
  })
})
