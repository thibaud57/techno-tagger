import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { page } from "../../../../fixtures/dialog"
import { action } from "../../../../fixtures/dom"
import { type NativeStub, nativeStub } from "../../../../fixtures/native-stub"
import {
  provideSidecarStub,
  sidecarStub,
  type SidecarStubOverrides,
} from "../../../../fixtures/sidecar-stub"
import { translateWith } from "../../../../fixtures/translate"
import {
  availableUpdate,
  failingUpdate,
  hangingUpdate,
  updaterStub,
} from "../../../../fixtures/updater"
import { NativeService } from "../../../core/platform/native.service"
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
) => {
  TestBed.configureTestingModule({
    imports: [UpdateDialogComponent],
    providers: [
      provideTranslateService(),
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

    const text = page().textContent

    expect(text).toContain("2.0.0 over 1.0.0")
    expect(action("later")).not.toBeNull()
    expect(action("install")).not.toBeNull()
  })

  it("sends the update to the badge on later", async () => {
    const { service } = await mount()

    action("later")?.click()

    expect(service.badgeVisible()).toBe(true)
  })

  it("sends the update to the badge on the cross", async () => {
    const { service } = await mount()

    cross()?.click()

    expect(service.badgeVisible()).toBe(true)
  })

  it("disables install while the engine is busy", async () => {
    // Trouvee pendant un travail, la mise a jour part au badge : la modale est rouverte par lui.
    const { fixture, service } = await mount(availableUpdate(), { writing: signal(true) })
    service.reopen()
    fixture.detectChanges()

    const install = action("install")

    expect(install?.disabled).toBe(true)
  })

  it("replaces the body with the progress while downloading", async () => {
    const { fixture } = await mount(neverEnding())
    action("install")?.click()
    fixture.detectChanges()

    const progress = page().querySelector("app-phase-progress")

    expect(progress).not.toBeNull()
    expect(action("install")).toBeNull()
    expect(action("later")).toBeNull()
    expect(cross()).toBeNull()
  })

  it("shows the failure with a retry", async () => {
    const { fixture, service } = await mount(failingUpdate())
    action("install")?.click()
    await vi.waitFor(() => {
      expect(service.state().kind).toBe("failed")
    })
    fixture.detectChanges()

    const text = page().textContent

    expect(text).toContain("update.failed")
    expect(action("install")?.textContent).toContain("update.retry")
    expect(action("later")).not.toBeNull()
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
    const { fixture } = await mount(neverEnding())
    translateWith({ update: { counter: "{{received}} of {{total}}" } })
    action("install")?.click()
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

    const notes = action("notes")

    expect(notes).toBeNull()
  })
})
