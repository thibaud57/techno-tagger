import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { FakeAppWindow } from "../../../../fixtures/app-window"
import { action, hostOf } from "../../../../fixtures/dom"
import { APP_WINDOW } from "../../../core/platform/app-window"

import { RESIZE_SETTLE_MS, WindowControlsComponent } from "./window-controls.component"

const mount = async () => {
  const appWindow = new FakeAppWindow()
  TestBed.configureTestingModule({
    imports: [WindowControlsComponent],
    providers: [provideTranslateService(), { provide: APP_WINDOW, useValue: appWindow }],
  })
  const fixture = TestBed.createComponent(WindowControlsComponent)
  await fixture.whenStable()
  fixture.detectChanges()

  return { fixture, appWindow, host: hostOf(fixture) }
}

describe("WindowControlsComponent", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("closes through the guarded close request, never by destroying the window", async () => {
    const { appWindow, host } = await mount()

    action("close", host)?.click()

    expect(appWindow.close).toHaveBeenCalledOnce()
    expect(appWindow.destroyed).toBe(0)
  })

  it("offers to restore once the window is maximized", async () => {
    const { fixture, appWindow, host } = await mount()
    vi.useFakeTimers()

    appWindow.resize(true)
    await vi.advanceTimersByTimeAsync(RESIZE_SETTLE_MS)
    fixture.detectChanges()

    expect(action("maximize", host)?.getAttribute("aria-label")).toBe("window.restore")
  })

  it("stops listening to the window once destroyed", async () => {
    const { fixture, appWindow } = await mount()

    fixture.destroy()

    expect(appWindow.resizeHandler).toBeNull()
  })
})
