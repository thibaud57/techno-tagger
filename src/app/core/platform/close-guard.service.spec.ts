import { TestBed } from "@angular/core/testing"

import { sidecarStub } from "../../../fixtures/sidecar-stub"
import { SidecarService } from "../sidecar/sidecar.service"
import { APP_WINDOW, type AppWindow, type CloseRequest } from "./app-window"
import { CloseGuard } from "./close-guard.service"

class FakeWindow implements AppWindow {
  handler: ((request: CloseRequest) => void) | null = null
  registrations = 0
  destroyed = 0
  inTauri = true
  refuseDestroy = false

  onCloseRequested(handler: (request: CloseRequest) => void): Promise<void> {
    this.registrations += 1
    if (this.inTauri) {
      this.handler = handler
    }

    return Promise.resolve()
  }

  destroy(): Promise<void> {
    if (this.refuseDestroy) {
      return Promise.reject(new Error("window.destroy not allowed"))
    }
    this.destroyed += 1

    return Promise.resolve()
  }

  /** Simule un clic sur la croix de la fenetre ; rend vrai si la garde l'a retenue. */
  close(): boolean {
    let held = false
    this.handler?.({
      preventDefault: () => {
        held = true
      },
    })

    return held
  }
}

const setup = async ({ inTauri = true } = {}) => {
  const appWindow = new FakeWindow()
  appWindow.inTauri = inTauri
  // `tagging`, `runConfirmable` et `arbitrationCount` : la garde ne les lit plus (plan de run).
  const sidecar = sidecarStub()
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_WINDOW, useValue: appWindow },
      { provide: SidecarService, useValue: sidecar },
    ],
  })
  const guard = TestBed.inject(CloseGuard)
  await guard.install()

  return { appWindow, sidecar, guard }
}

describe("CloseGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lets the window close when no work is pending", async () => {
    const { appWindow, guard } = await setup()

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it("holds the window and asks for confirmation during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "extraction" }])
  })

  it("lets the window close during a run, with arbitrations pending or a run left unwritten", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    sidecar.arbitrationCount.set(3)
    sidecar.runConfirmable.set(true)

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it("lists the pending work in a fixed order", async () => {
    const { sidecar, guard } = await setup()

    sidecar.rollingBack.set({ runId: "a3f9c1", trackId: null })
    sidecar.writing.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual([
      { kind: "extraction" },
      { kind: "write" },
      { kind: "rollback" },
    ])
  })

  it("closes the window for good when the user leaves", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(appWindow.destroyed).toBe(1)
  })

  it("keeps the window open when the user stays", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    guard.stay()

    expect(guard.request()).toBeNull()
    expect(appWindow.destroyed).toBe(0)
  })

  it("installs its listener only once", async () => {
    const { appWindow, guard } = await setup()

    await guard.install()

    expect(appWindow.registrations).toBe(1)
  })

  it("stays silent outside Tauri", async () => {
    const { appWindow, sidecar, guard } = await setup({ inTauri: false })
    sidecar.extracting.set(true)

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it("keeps the snapshot when the work ends during the confirmation", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    sidecar.extracting.set(false)

    expect(guard.request()).toEqual([{ kind: "extraction" }])
  })

  it("replaces the snapshot when closing is asked again", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()
    sidecar.writing.set(true)

    appWindow.close()

    expect(guard.request()).toEqual([{ kind: "extraction" }, { kind: "write" }])
  })

  it("reopens the application when the window refuses to close", async () => {
    const { appWindow, sidecar, guard } = await setup()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    appWindow.refuseDestroy = true
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.request()).toBeNull()
  })

  it("refuses to close while files are being written", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.writing.set(true)

    const held = appWindow.close()
    await guard.leave()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "write" }])
    expect(guard.blocked()).toBe(true)
    expect(appWindow.destroyed).toBe(0)
  })

  it("refuses to close while a rollback runs", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.rollingBack.set({ runId: "a3f9c1", trackId: null })

    const held = appWindow.close()
    await guard.leave()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "rollback" }])
    expect(guard.blocked()).toBe(true)
    expect(appWindow.destroyed).toBe(0)
  })

  it("lets the user leave during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })

  it("lets the user leave once the write ends while the dialog is open", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.writing.set(true)
    appWindow.close()

    sidecar.writing.set(false)
    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })
})
