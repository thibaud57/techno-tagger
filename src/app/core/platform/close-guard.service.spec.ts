import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { FakeAppWindow } from "../../../fixtures/app-window"
import { silenceConsoleError } from "../../../fixtures/console"
import { type SidecarStub, provideSidecarStub, sidecarStub } from "../../../fixtures/sidecar-stub"
import { rollbackInFlight } from "../../../fixtures/write"
import { APP_WINDOW } from "./app-window"
import { CloseGuard } from "./close-guard.service"

const setup = async ({ inTauri = true } = {}) => {
  const appWindow = new FakeAppWindow()
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
      sidecar.rollingBack.set(rollbackInFlight())
    },
    kind: "rollback",
    blocked: true,
  },
] as const

describe("CloseGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      case: "no work is pending",
      inTauri: true,
      start: () => undefined,
    },
    {
      case: "a run has arbitrations pending or is left unwritten",
      inTauri: true,
      start: (sidecar: SidecarStub) => {
        sidecar.tagging.set(true)
        sidecar.arbitrationCount.set(3)
        sidecar.runConfirmable.set(true)
      },
    },
    {
      case: "an extraction runs outside Tauri",
      inTauri: false,
      start: (sidecar: SidecarStub) => {
        sidecar.extracting.set(true)
      },
    },
  ])("lets the window close when $case", async ({ inTauri, start }) => {
    const { appWindow, sidecar, guard } = await setup({ inTauri })
    start(sidecar)

    const held = appWindow.requestClose()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it.each(PENDING)("holds the window while $case", async ({ start, kind, blocked }) => {
    const { appWindow, sidecar, guard } = await setup()
    start(sidecar)

    const held = appWindow.requestClose()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([kind])
    expect(guard.blocked()).toBe(blocked)
  })

  it("closes the window for good when the user leaves during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.requestClose()

    await guard.leave()

    expect(appWindow.destroyed).toBe(1)
  })

  it.each(PENDING.filter((work) => work.blocked))(
    "keeps the window open when the user leaves while $case",
    async ({ start }) => {
      const { appWindow, sidecar, guard } = await setup()
      start(sidecar)
      appWindow.requestClose()

      await guard.leave()

      expect(appWindow.destroyed).toBe(0)
    },
  )

  it("lists the pending work in a fixed order", async () => {
    const { sidecar, guard } = await setup()

    sidecar.rollingBack.set(rollbackInFlight())
    sidecar.writing.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual(["extraction", "write", "rollback"])
  })

  it("keeps the window open when the user stays", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.requestClose()

    guard.stay()

    expect(guard.request()).toBeNull()
    expect(appWindow.destroyed).toBe(0)
  })

  it("installs its listener only once", async () => {
    const { appWindow, guard } = await setup()

    await guard.install()

    expect(appWindow.registrations).toBe(1)
  })

  it("keeps the snapshot when the work ends during the confirmation", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.requestClose()

    sidecar.extracting.set(false)

    expect(guard.request()).toEqual(["extraction"])
  })

  it("replaces the snapshot when closing is asked again", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.requestClose()
    sidecar.writing.set(true)

    appWindow.requestClose()

    expect(guard.request()).toEqual(["extraction", "write"])
  })

  it("reopens the application when the window refuses to close", async () => {
    const { appWindow, sidecar, guard } = await setup()
    silenceConsoleError()
    appWindow.refuseDestroy = true
    sidecar.extracting.set(true)
    appWindow.requestClose()

    await guard.leave()

    expect(guard.request()).toBeNull()
  })

  it("lets the user leave once the write ends while the dialog is open", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.writing.set(true)
    appWindow.requestClose()

    sidecar.writing.set(false)
    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })
})
