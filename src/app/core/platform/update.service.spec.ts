import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { INTERRUPTED } from "../../../fixtures/resume"
import {
  provideSidecarStub,
  sidecarStub,
  type SidecarStubOverrides,
} from "../../../fixtures/sidecar-stub"
import {
  availableUpdate,
  failingUpdate,
  hangingUpdate,
  updaterStub,
} from "../../../fixtures/updater"
import type { DetectedRun } from "../stores/resume.store"

import { APP_UPDATER } from "./updater"

// Un vi.mock de tete de @sentry/angular n'est pas applique de facon fiable sous le builder
// unit-test (vu sur sentry-selftest.service.spec.ts lance seul) : doMock puis import dynamique.
vi.doMock("@sentry/angular", () => ({ captureException: vi.fn() }))
const { UpdateService } = await import("./update.service")
const Sentry = await import("@sentry/angular")

const mount = (updater: ReturnType<typeof updaterStub>, overrides: SidecarStubOverrides = {}) => {
  const sidecar = sidecarStub(overrides)
  TestBed.configureTestingModule({
    providers: [{ provide: APP_UPDATER, useValue: updater }, provideSidecarStub(sidecar)],
  })

  return { service: TestBed.inject(UpdateService), sidecar, updater }
}

describe("UpdateService", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
  })

  it("offers nothing when no update is published", async () => {
    const { service } = mount(updaterStub(null))

    await service.check()

    expect(service.update()).toBeNull()
    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(false)
  })

  it("stays silent and reports nothing when the check fails", async () => {
    const { service } = mount(updaterStub(new Error("offline")))

    await service.check()

    expect(service.update()).toBeNull()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it("opens the dialog on the update found at startup", async () => {
    const { service } = mount(updaterStub(availableUpdate()))

    await service.check()

    expect(service.update()?.version).toBe("2.0.0")
    expect(service.dialogVisible()).toBe(true)
  })

  it("sends the update straight to the badge while the resume prompt shows", async () => {
    const { service } = mount(updaterStub(availableUpdate()), {
      interruptedRun: signal<DetectedRun | null>(INTERRUPTED),
    })

    await service.check()

    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(true)
  })

  it("sends an update found during a run straight to the badge", async () => {
    const { service } = mount(updaterStub(availableUpdate()), { tagging: signal(true) })

    await service.check()

    expect(service.badgeVisible()).toBe(true)
  })

  it("keeps the badge once the resume prompt shows up before any gesture", async () => {
    const { service, sidecar } = mount(updaterStub(availableUpdate()))
    await service.check()
    // Lu a chaque changement, comme le gabarit du shell a chaque detection : c'est ce qui
    // donne a `previous` chaque etat traverse.
    const beforeResume = service.dialogVisible()
    sidecar.interruptedRun.set(INTERRUPTED)
    const whileResumeShows = service.dialogVisible()

    sidecar.interruptedRun.set(null)

    expect(beforeResume).toBe(true)
    expect(whileResumeShows).toBe(false)
    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(true)
  })

  it("keeps the dialog visible when the resume prompt shows up during the download", async () => {
    const { service, sidecar } = mount(updaterStub(hangingUpdate()))
    await service.check()
    void service.install()
    const beforeResume = service.dialogVisible()

    sidecar.interruptedRun.set(INTERRUPTED)

    expect(beforeResume).toBe(true)
    expect(service.dialogVisible()).toBe(true)
    expect(service.badgeVisible()).toBe(false)
  })

  it("reopens the dialog from the badge", async () => {
    const { service } = mount(updaterStub(availableUpdate()))
    await service.check()
    service.dismiss()

    service.reopen()

    expect(service.dialogVisible()).toBe(true)
    expect(service.badgeVisible()).toBe(false)
  })

  it("refuses to install while the engine is busy", async () => {
    const update = availableUpdate()
    const { service } = mount(updaterStub(update), { tagging: signal(true) })
    await service.check()

    await service.install()

    expect(service.installable()).toBe(false)
    expect(update.downloadAndInstall).not.toHaveBeenCalled()
  })

  it("follows the download progress", async () => {
    const update = hangingUpdate({ received: 4, total: 10 })
    const { service } = mount(updaterStub(update))
    await service.check()

    void service.install()

    expect(service.state()).toEqual({
      kind: "downloading",
      update,
      progress: { received: 4, total: 10 },
    })
  })

  it("reports a failed download to Sentry and offers a retry", async () => {
    const { service } = mount(updaterStub(failingUpdate()))
    await service.check()

    await service.install()

    expect(service.state().kind).toBe("failed")
    expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      tags: { area: "updater" },
    })
  })

  it("checks again, releases the failed update and restarts the download on retry", async () => {
    const failed = failingUpdate()
    const retried = availableUpdate()
    const updater = updaterStub(failed)
    const { service } = mount(updater)
    await service.check()
    await service.install()
    updater.check.mockResolvedValueOnce(retried)

    const pending = service.retry()
    const during = service.state().kind
    await pending

    expect(during).toBe("downloading")
    expect(updater.check).toHaveBeenCalledTimes(2)
    expect(failed.close).toHaveBeenCalledOnce()
    expect(retried.downloadAndInstall).toHaveBeenCalledOnce()
  })

  it("keeps the failed update when the retry check fails", async () => {
    const failed = failingUpdate()
    const updater = updaterStub(failed)
    const { service } = mount(updater)
    await service.check()
    await service.install()
    updater.check.mockRejectedValueOnce(new Error("offline"))

    await service.retry()

    expect(service.state()).toEqual({ kind: "failed", update: failed })
    expect(failed.close).not.toHaveBeenCalled()
  })

  it("withdraws the offer when the retry finds nothing", async () => {
    const updater = updaterStub(failingUpdate())
    const { service } = mount(updater)
    await service.check()
    await service.install()
    updater.check.mockResolvedValueOnce(null)

    await service.retry()

    expect(service.update()).toBeNull()
  })
})
