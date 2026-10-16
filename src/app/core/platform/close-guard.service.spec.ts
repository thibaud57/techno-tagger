import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { silenceConsoleError } from "../../../fixtures/console"
import { type SidecarStub, provideSidecarStub, sidecarStub } from "../../../fixtures/sidecar-stub"
import { RUN_ID } from "../../../fixtures/tagging"
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
  const sidecar = sidecarStub()
  TestBed.configureTestingModule({
    providers: [{ provide: APP_WINDOW, useValue: appWindow }, provideSidecarStub(sidecar)],
  })
  const guard = TestBed.inject(CloseGuard)
  await guard.install()

  return { appWindow, sidecar, guard }
}

/** Les travaux que la garde retient : seule une ecriture ou une restauration interdit de partir. */
const PENDING = [
  {
    case: "an extraction runs",
    start: (sidecar: SidecarStub) => {
      sidecar.extracting.set(true)
    },
    kind: "extraction",
    blocked: false,
  },
  {
    case: "files are being written",
    start: (sidecar: SidecarStub) => {
      sidecar.writing.set(true)
    },
    kind: "write",
    blocked: true,
  },
  {
    case: "a rollback runs",
    start: (sidecar: SidecarStub) => {
      sidecar.rollingBack.set({ runId: RUN_ID, trackId: null })
    },
    kind: "rollback",
    blocked: true,
  },
] as const

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

  it.each(PENDING)("holds the window while $case", async ({ start, kind, blocked }) => {
    const { appWindow, sidecar, guard } = await setup()
    start(sidecar)

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind }])
    expect(guard.blocked()).toBe(blocked)
  })

  it("closes the window for good when the user leaves during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(appWindow.destroyed).toBe(1)
  })

  it.each(PENDING.filter((work) => work.blocked))(
    "keeps the window open when the user leaves while $case",
    async ({ start }) => {
      const { appWindow, sidecar, guard } = await setup()
      start(sidecar)
      appWindow.close()

      await guard.leave()

      expect(appWindow.destroyed).toBe(0)
    },
  )

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

    sidecar.rollingBack.set({ runId: RUN_ID, trackId: null })
    sidecar.writing.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual([
      { kind: "extraction" },
      { kind: "write" },
      { kind: "rollback" },
    ])
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
    silenceConsoleError()
    appWindow.refuseDestroy = true
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.request()).toBeNull()
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
