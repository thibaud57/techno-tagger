import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import { APP_WINDOW, type AppWindow, type CloseRequest } from "./app-window"
import { CloseGuard } from "./close-guard.service"
import { SidecarService } from "./sidecar.service"

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
  const sidecar = {
    extracting: signal(false),
    tagging: signal(false),
    arbitrationCount: signal(0),
  }
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

type Sidecar = Awaited<ReturnType<typeof setup>>["sidecar"]

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

  it.each<[string, (sidecar: Sidecar) => void]>([
    [
      "an extraction",
      (sidecar) => {
        sidecar.extracting.set(true)
      },
    ],
    [
      "a tagging run",
      (sidecar) => {
        sidecar.tagging.set(true)
      },
    ],
    [
      "pending arbitrations",
      (sidecar) => {
        sidecar.arbitrationCount.set(2)
      },
    ],
  ])("holds the window and asks for confirmation during %s", async (_work, start) => {
    const { appWindow, sidecar, guard } = await setup()
    start(sidecar)

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toHaveLength(1)
  })

  it("lists the pending work in a fixed order", async () => {
    const { sidecar, guard } = await setup()

    sidecar.arbitrationCount.set(2)
    sidecar.tagging.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual([
      { kind: "extraction" },
      { kind: "tagging" },
      { kind: "arbitration", count: 2 },
    ])
  })

  it("closes the window for good when the user leaves", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()

    await guard.leave()

    expect(appWindow.destroyed).toBe(1)
  })

  it("keeps the window open when the user stays", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
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
    sidecar.tagging.set(true)
    appWindow.close()

    sidecar.tagging.set(false)

    expect(guard.request()).toEqual([{ kind: "tagging" }])
  })

  it("replaces the snapshot when closing is asked again", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()
    sidecar.arbitrationCount.set(1)

    appWindow.close()

    expect(guard.request()).toEqual([{ kind: "tagging" }, { kind: "arbitration", count: 1 }])
  })

  it("reopens the application when the window refuses to close", async () => {
    const { appWindow, sidecar, guard } = await setup()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    appWindow.refuseDestroy = true
    sidecar.tagging.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.request()).toBeNull()
  })
})
