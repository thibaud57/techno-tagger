import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { sidecarStub } from "../../../fixtures/sidecar-stub"
import { SidecarService } from "../sidecar/sidecar.service"

import { CAPTURE_EXCEPTION } from "./capture-exception"
import { SELFTEST_PATH, SentrySelftestService } from "./sentry-selftest.service"

const setUp = () => {
  const asked = signal(false)
  const captureException = vi.fn()
  TestBed.configureTestingModule({
    providers: [
      { provide: SidecarService, useValue: sidecarStub({ sentrySelftest: asked }) },
      { provide: CAPTURE_EXCEPTION, useValue: captureException },
    ],
  })
  TestBed.inject(SentrySelftestService)

  return { asked, captureException }
}

describe("SentrySelftestService", () => {
  it("sends a single test event per launch, even when the engine asks again", () => {
    const { asked, captureException } = setUp()

    asked.set(true)
    TestBed.tick()
    asked.set(false)
    TestBed.tick()
    asked.set(true)
    TestBed.tick()

    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      new Error(`sentry self test, must be masked: ${SELFTEST_PATH}`),
    )
  })

  it("sends nothing when the engine does not ask", () => {
    const { captureException } = setUp()

    TestBed.tick()

    expect(captureException).not.toHaveBeenCalled()
  })
})
