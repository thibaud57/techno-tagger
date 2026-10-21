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
import { preferencesStub } from "../../../fixtures/preferences-stub"
import { CAPTURE_EXCEPTION } from "../observability/capture-exception"
import type { DetectedRun } from "../stores/resume.store"

import { PreferencesService } from "./preferences.service"
import { UpdateService } from "./update.service"
import { APP_UPDATER } from "./updater"

const captureException = vi.fn()

const mount = (
  updater: ReturnType<typeof updaterStub>,
  overrides: SidecarStubOverrides = {},
  preferences = preferencesStub(),
) => {
  const sidecar = sidecarStub(overrides)
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_UPDATER, useValue: updater },
      { provide: CAPTURE_EXCEPTION, useValue: captureException },
      { provide: PreferencesService, useValue: preferences },
      provideSidecarStub(sidecar),
    ],
  })

  return { service: TestBed.inject(UpdateService), sidecar, updater, preferences }
}

describe("UpdateService", () => {
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
    expect(captureException).not.toHaveBeenCalled()
  })

  it("reports the latest version when the manual check finds nothing", async () => {
    const { service } = mount(updaterStub(null))

    const outcome = await service.checkNow()

    expect(outcome).toBe("upToDate")
    expect(service.dialogVisible()).toBe(false)
  })

  it("opens the dialog on an update found by the manual check", async () => {
    const { service } = mount(updaterStub(availableUpdate()))

    const outcome = await service.checkNow()

    expect(outcome).toBe("found")
    expect(service.dialogVisible()).toBe(true)
  })

  it("reports a failed manual check without Sentry", async () => {
    const { service } = mount(updaterStub(new Error("offline")))

    const outcome = await service.checkNow()

    expect(outcome).toBe("failed")
    expect(captureException).not.toHaveBeenCalled()
  })

  it("reopens a known update without checking again", async () => {
    const { service, updater } = mount(updaterStub(failingUpdate()))
    await service.check()
    await service.install()
    service.dismiss()

    const outcome = await service.checkNow()

    expect(outcome).toBe("found")
    expect(service.dialogVisible()).toBe(true)
    expect(service.state().kind).toBe("failed")
    expect(updater.check).toHaveBeenCalledOnce()
  })

  it("keeps the known update when a second check finds another one", async () => {
    const first = availableUpdate({ version: "2.0.0" })
    const second = availableUpdate({ version: "2.1.0" })
    const updater = updaterStub(first)
    const { service } = mount(updater)
    await service.check()
    updater.check.mockResolvedValueOnce(second)

    await service.check()

    expect(service.update()?.version).toBe("2.0.0")
    expect(second.close).toHaveBeenCalledOnce()
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
    // Lu a chaque changement : le verrou ne voit que les etats lus.
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

    await vi.waitFor(() => {
      expect(service.state()).toEqual({
        kind: "downloading",
        update,
        progress: { received: 4, total: 10 },
      })
    })
  })

  it("reports a failed download to Sentry and offers a retry", async () => {
    const { service } = mount(updaterStub(failingUpdate()))
    await service.check()

    await service.install()

    expect(service.state().kind).toBe("failed")
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
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

  it("records the attempt before downloading", async () => {
    const update = hangingUpdate()
    const { service, preferences } = mount(updaterStub(update))
    await service.check()
    preferences.writeUpdateAttempt.mockClear()

    void service.install()

    await vi.waitFor(() => {
      expect(update.downloadAndInstall).toHaveBeenCalled()
    })
    expect(preferences.writeUpdateAttempt).toHaveBeenCalledWith({
      from: APP_VERSION,
      to: "2.0.0",
    })
    const [written] = preferences.writeUpdateAttempt.mock.invocationCallOrder
    const [downloaded] = vi.mocked(update.downloadAndInstall).mock.invocationCallOrder
    expect(written).toBeLessThan(downloaded ?? 0)
  })

  it("flags a failed installation when the app still runs the version it left", async () => {
    const preferences = preferencesStub({ updateAttempt: { from: APP_VERSION, to: "99.0.0" } })
    const { service } = mount(updaterStub(null), {}, preferences)

    await service.check()

    expect(service.installFailed()).toBe("99.0.0")
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      new Error("update install did not complete"),
      { tags: { area: "updater" } },
    )
  })

  it("reports nothing when the app runs the targeted version", async () => {
    const preferences = preferencesStub({ updateAttempt: { from: "0.0.1", to: APP_VERSION } })
    const { service } = mount(updaterStub(null), {}, preferences)

    await service.check()

    expect(service.installFailed()).toBeNull()
    expect(captureException).not.toHaveBeenCalled()
  })

  it("clears the attempt once read at startup", async () => {
    const preferences = preferencesStub({ updateAttempt: { from: APP_VERSION, to: "99.0.0" } })
    const { service } = mount(updaterStub(null), {}, preferences)

    await service.check()

    expect(preferences.writeUpdateAttempt).toHaveBeenLastCalledWith(null)
  })

  it("clears the attempt when the download fails", async () => {
    const { service, preferences } = mount(updaterStub(failingUpdate()))
    await service.check()

    await service.install()

    expect(preferences.writeUpdateAttempt).toHaveBeenLastCalledWith(null)
  })

  it("forgets the failed installation once a new attempt starts", async () => {
    const preferences = preferencesStub({ updateAttempt: { from: APP_VERSION, to: "99.0.0" } })
    const { service } = mount(updaterStub(hangingUpdate()), {}, preferences)
    await service.check()

    void service.install()

    await vi.waitFor(() => {
      expect(service.installFailed()).toBeNull()
    })
  })
})
