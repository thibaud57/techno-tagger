import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { sidecarStub } from "../../../fixtures/sidecar-stub"
import { SidecarService } from "../sidecar/sidecar.service"

// Un vi.mock de tete de @sentry/angular n'est pas applique de facon fiable sous le builder
// unit-test (spec rouge lancee seule) : doMock puis import dynamique.
vi.doMock("@sentry/angular", () => ({ captureException: vi.fn() }))
const { SELFTEST_PATH, SentrySelftestService } = await import("./sentry-selftest.service")
const Sentry = await import("@sentry/angular")

const setUp = () => {
  const asked = signal(false)
  TestBed.configureTestingModule({
    providers: [{ provide: SidecarService, useValue: sidecarStub({ sentrySelftest: asked }) }],
  })
  TestBed.inject(SentrySelftestService)

  return asked
}

describe("SentrySelftestService", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("sends a single test event per launch, even when the engine asks again", () => {
    const asked = setUp()

    asked.set(true)
    TestBed.tick()
    asked.set(false)
    TestBed.tick()
    asked.set(true)
    TestBed.tick()

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[0]).toEqual(
      new Error(`sentry self test, must be masked: ${SELFTEST_PATH}`),
    )
  })

  it("sends nothing when the engine does not ask", () => {
    setUp()

    TestBed.tick()

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
